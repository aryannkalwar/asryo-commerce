import { randomUUID, createHash } from 'node:crypto';
import { renderDesign } from './public/studio-render.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) fail(`Invalid ${label}.`);
  return value.trim();
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const number = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`Invalid ${label}.`);
  return Math.round(value * 100) / 100;
};
const color = value => /^#[a-f0-9]{6}$/i.test(value || '') ? value.toLowerCase() : fail('Use a six-digit colour.');

export function validateArtwork(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 1400000) fail('Artwork must be PNG, JPEG or WebP below 1 MB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) fail('Only embedded PNG, JPEG and WebP images are supported.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2] || bytes.length > 1024 * 1024) fail('Invalid image encoding or image too large.');
  const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
  if (!valid) fail('Image contents do not match the selected format.');
  return value;
}

export function validateDesign(input) {
  if (!object(input) || !object(input.design)) fail('Invalid design project.');
  const name = text(input.name, 100, 'project title');
  if (!name) fail('Enter a project title.');
  const d = input.design;
  if (!['tshirt','hoodie'].includes(d.garment)) fail('Choose a T-shirt or hoodie.');
  if (!object(d.sides) || !object(d.measurements)) fail('Add front/back artwork and measurement fields.');
  const measurements = {};
  for (const key of ['chest','length','printWidth']) {
    measurements[key] = d.measurements[key] === null ? null : number(d.measurements[key], 1, 200, key);
  }
  const sides = {};
  for (const side of ['front','back']) {
    const layer = d.sides[side];
    if (!object(layer)) fail('Both garment views are required.');
    sides[side] = {
      text: text(layer.text, 60, 'artwork text'), ink: color(layer.ink), artwork: validateArtwork(layer.artwork),
      x: number(layer.x, 200, 400, 'horizontal position'), y: number(layer.y, 180, 540, 'vertical position'),
      width: number(layer.width, 20, 240, 'artwork size'), rotation: number(layer.rotation, -180, 180, 'rotation'),
    };
  }
  const design = {
    garment:d.garment, color:color(d.color), fabric:text(d.fabric, 300, 'fabric notes'),
    gsm:d.gsm === null ? null : number(d.gsm, 80, 600, 'GSM'),
    printMethod:text(d.printMethod, 100, 'print method'), notes:text(d.notes, 3000, 'sample notes'), measurements, sides,
  };
  return {name, design};
}

export function initializeStudio(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS studio_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, design_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS studio_history (
    project_id TEXT NOT NULL REFERENCES studio_projects(id), revision INTEGER NOT NULL,
    event TEXT NOT NULL, at TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    PRIMARY KEY(project_id,revision)
  );
  CREATE TABLE IF NOT EXISTS studio_imports (
    project_id TEXT PRIMARY KEY REFERENCES studio_projects(id), product_id TEXT NOT NULL UNIQUE REFERENCES products(id),
    approved_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
}

function record(row) {
  return {id:row.id,name:row.name,design:JSON.parse(row.design_json),status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};
}
function load(db, id) {
  const row = db.prepare('SELECT * FROM studio_projects WHERE id=?').get(id);
  if (!row) fail('Design project not found.',404);
  return record(row);
}
function history(db, p, event) {
  // Keep an audit fingerprint without duplicating megabytes of raster data on every edit.
  const snapshot = structuredClone(p);
  for (const side of Object.values(snapshot.design.sides)) {
    side.artworkSha256 = side.artwork ? createHash('sha256').update(side.artwork).digest('hex') : null;
    delete side.artwork;
  }
  db.prepare('INSERT INTO studio_history(project_id,revision,event,at,snapshot_json) VALUES(?,?,?,?,?)')
    .run(p.id,p.revision,event,p.updatedAt,JSON.stringify(snapshot));
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function revise(db, id, input, change, event) {
  return transaction(db, () => {
    const p = load(db,id);
    if (!Number.isSafeInteger(input?.revision) || input.revision !== p.revision) fail('This project changed. Reload it before saving; your edits have not been overwritten.',409);
    const next = {...p,...change(p),revision:p.revision+1,updatedAt:new Date().toISOString()};
    db.prepare('UPDATE studio_projects SET name=?,design_json=?,status=?,revision=?,updated_at=? WHERE id=?')
      .run(next.name,JSON.stringify(next.design),next.status,next.revision,next.updatedAt,id);
    history(db,next,event);
    return next;
  });
}

export function importApprovedProject(db, id, revision) {
  return transaction(db, () => {
    const project = load(db,id);
    const old = db.prepare('SELECT product_id,approved_revision FROM studio_imports WHERE project_id=?').get(id);
    if (old) return {productId:old.product_id,approvedRevision:old.approved_revision,created:false};
    if (project.status !== 'approved' || revision !== project.revision) fail('Approve and save this exact design revision before creating a product draft.',409);
    const productId = 'ASR-DESIGN-' + randomUUID();
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO products(id,name,category,type,image,description,price_paise,stock,active,options_json,updated_at)
      VALUES(?,?,'clothing',?,?,?,NULL,NULL,0,'[]',?)`)
      .run(productId,project.name,project.design.garment === 'hoodie' ? 'Hoodie' : 'T-shirt','studio:'+id,
        'Approved design concept. Product specifications, size measurements, price and stock require confirmation before sale.',at);
    db.prepare('INSERT INTO studio_imports(project_id,product_id,approved_revision,snapshot_json,created_at) VALUES(?,?,?,?,?)')
      .run(id,productId,project.revision,JSON.stringify(project),at);
    return {productId,approvedRevision:project.revision,created:true};
  });
}

export function renderImportedProduct(db, id) {
  initializeStudio(db);
  const row = db.prepare('SELECT snapshot_json FROM studio_imports WHERE product_id=?').get(id);
  return row ? renderDesign(JSON.parse(row.snapshot_json),'front') : null;
}

export async function handleStudio({db,req,res,path,json,jsonBody}) {
  initializeStudio(db);
  const base = '/api/admin/designs';
  if (path === base && req.method === 'GET') {
    const rows = db.prepare(`SELECT p.id,p.name,p.status,p.revision,p.created_at,p.updated_at,i.product_id,
      json_extract(p.design_json,'$.garment') AS garment
      FROM studio_projects p LEFT JOIN studio_imports i ON i.project_id=p.id ORDER BY p.updated_at DESC LIMIT 200`).all();
    return json(res,200,{projects:rows.map(p=>({id:p.id,name:p.name,status:p.status,revision:p.revision,garment:p.garment,productId:p.product_id,updatedAt:p.updated_at}))});
  }
  if (path === base && req.method === 'POST') {
    const input = validateDesign(await jsonBody(req,3*1024*1024));
    if (db.prepare('SELECT COUNT(*) AS n FROM studio_projects').get().n >= 500) fail('Project limit reached. Export existing projects before adding more.',409);
    const at = new Date().toISOString();
    const project = {id:randomUUID(),...input,status:'draft',revision:1,createdAt:at,updatedAt:at};
    transaction(db,()=>{
      db.prepare('INSERT INTO studio_projects(id,name,design_json,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(project.id,project.name,JSON.stringify(project.design),'draft',1,at,at);
      history(db,project,'created');
    });
    return json(res,201,{project});
  }
  const match = path.match(/^\/api\/admin\/designs\/([a-f0-9-]{36})(?:\/(history|review|approve|draft-sku|techpack|front.svg|back.svg))?$/);
  if (!match) return json(res,404,{error:'Studio resource not found.'});
  const [,id,action] = match;
  if (req.method === 'GET') {
    const project = load(db,id);
    if (!action) return json(res,200,{project});
    if (action === 'history') return json(res,200,{history:db.prepare('SELECT revision,event,at FROM studio_history WHERE project_id=? ORDER BY revision DESC LIMIT 50').all(id)});
    if (action === 'techpack') {
      res.setHeader('Content-Disposition',`attachment; filename="ASRYO-techpack-${id}.json"`);
      return json(res,200,{format:'asryo-techpack-v1',project,notice:'Design study and sample worksheet. Not CAD pattern grading or confirmed manufacturing specifications. Verify artwork resolution, measurements and wash tests on a physical sample.'});
    }
    if (action.endsWith('.svg')) {
      res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control','private, no-store');
      res.setHeader('Content-Security-Policy',"default-src 'none'; img-src data:; style-src 'none'; sandbox");
      res.setHeader('Content-Disposition',`attachment; filename="ASRYO-${id}-${action}"`);
      res.statusCode=200; return res.end(renderDesign(project,action.startsWith('back')?'back':'front'));
    }
  }
  if (req.method === 'PUT' && !action) {
    const input = await jsonBody(req,3*1024*1024);
    const parsed = validateDesign(input);
    return json(res,200,{project:revise(db,id,input,()=>({...parsed,status:'draft'}),'saved')});
  }
  if (req.method === 'POST' && ['review','approve','draft-sku'].includes(action)) {
    const input = await jsonBody(req,1024);
    if (action === 'draft-sku') return json(res,200,importApprovedProject(db,id,input?.revision));
    const project = revise(db,id,input,p=>{
      if (action === 'review') {
        if (p.status !== 'draft') fail('Only a draft can be submitted for review.',409);
        if (!Object.values(p.design.sides).some(s=>s.artwork || s.text)) fail('Add artwork or text before requesting review.');
        return {status:'in_review'};
      }
      if (p.status !== 'in_review') fail('Submit this design for review before approval.',409);
      return {status:'approved'};
    },action === 'review'?'submitted_for_review':'approved');
    return json(res,200,{project});
  }
  return json(res,405,{error:'Method not allowed.'});
}

// ASRYO Cofounder: on-demand, idempotent, human-reviewed business alerts.
// No external side effects or changes to catalog, orders or subscriptions.
import { randomUUID } from 'node:crypto';

function init(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cofounder_automation_events(
    id TEXT PRIMARY KEY,
    rule_key TEXT NOT NULL,
    business_day TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(rule_key,business_day)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS cofounder_automation_events_recent ON cofounder_automation_events(created_at DESC)');
}

const readEvents = db => db.prepare(
  'SELECT id,rule_key AS ruleKey,business_day AS businessDay,title,detail,priority,status,created_at AS createdAt,updated_at AS updatedAt '+
  'FROM cofounder_automation_events ORDER BY created_at DESC,rule_key LIMIT 100'
).all();

function recommendations(db, moment) {
  const rules = [];
  const minStock = 5;
  const low = db.prepare(
    'SELECT id,name,stock FROM products WHERE active=1 AND stock IS NOT NULL AND stock<=? ORDER BY stock ASC LIMIT 30'
  ).all(minStock);
  for (const p of low) {
    rules.push({
      key:'low_stock:'+p.id, priority:p.stock===0?'high':'medium',
      title:'Review inventory: '+p.name,
      detail:p.name+' has '+p.stock+' units in confirmed active inventory. Verify physical stock, incoming deliveries, supplier lead time and demand before considering replenishment.'
    });
  }

  const cutoff = new Date(moment.getTime()-48*3600*1000).toISOString();
  const oldOrders = db.prepare(
    "SELECT COUNT(*) AS n FROM orders WHERE status='processing' AND created_at<?"
  ).get(cutoff).n;
  if (oldOrders) rules.push({
    key:'orders_processing_48h',priority:'high',
    title:'Review processing orders',
    detail:oldOrders+' orders remain processing after 48 hours. Check fulfillment and provide verified updates where necessary.'
  });

  const ready = String(process.env.STORE_READY).toLowerCase()==='true' &&
    String(process.env.HIDE_PUBLIC_PRODUCTS ?? 'true').toLowerCase()==='false' &&
    db.prepare('SELECT COUNT(*) AS n FROM products WHERE active=1 AND price_paise>0 AND stock>0').get().n>0;
  if (!ready) rules.push({
    key:'store_not_ready',priority:'info',
    title:'Verify storefront launch readiness',
    detail:'Storefront is closed. Confirm real product stock, pricing, policies, support details and fulfillment before considering checkout launch.'
  });

  const verified = db.prepare(
    'SELECT COUNT(*) AS n FROM early_access WHERE verified_at IS NOT NULL AND unsubscribed_at IS NULL'
  ).get().n;
  if (verified===0) rules.push({
    key:'no_verified_subscribers',priority:'info',
    title:'Review consent-based audience building',
    detail:'There are no verified, active early-access subscribers. Validate the optional opt-in flow; do not send to unverified contacts.'
  });
  return rules;
}

export function evaluateCofounderAutomations(db, moment = new Date()) {
  init(db);
  if (!(moment instanceof Date) || !Number.isFinite(moment.getTime())) throw new Error('Invalid evaluation date');
  const time=moment.toISOString(),businessDay=time.slice(0,10);
  const suggestions = recommendations(db,moment);
  const insert=db.prepare(
    `INSERT OR IGNORE INTO cofounder_automation_events
    (id,rule_key,business_day,title,detail,priority,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'pending',?,?)`
  );
  let added=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const rule of suggestions) {
      const record=insert.run(randomUUID(),rule.key,businessDay,rule.title,rule.detail,rule.priority,time,time);
      added+=record.changes;
    }
    db.exec('COMMIT');
  } catch(err) {
    db.exec('ROLLBACK');throw err;
  }
  return {businessDay,evaluated:suggestions.length,newRecommendations:added,events:readEvents(db)};
}

export function getCofounderAutomations(db) {
  init(db);
  return {events:readEvents(db)};
}

export function reviewCofounderAutomation(db, id, status) {
  init(db);
  if (!/^[a-f0-9-]{36}$/i.test(String(id||''))) return {error:'Invalid recommendation ID',code:400};
  if (!['reviewed','dismissed','pending'].includes(status)) return {error:'Invalid review status',code:400};
  const row=db.prepare('SELECT id FROM cofounder_automation_events WHERE id=?').get(id);
  if(!row)return {error:'Recommendation not found',code:404};
  db.prepare('UPDATE cofounder_automation_events SET status=?,updated_at=? WHERE id=?')
    .run(status,new Date().toISOString(),id);
  return {ok:true,events:readEvents(db),note:'Only recommendation status was changed. No external action was executed.'};
}

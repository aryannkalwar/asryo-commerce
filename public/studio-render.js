// Shared technical sketch renderer. Only validated project data reaches saved exports.
export const escapeXML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function garmentPath(kind) {
  return kind === 'hoodie'
    ? 'M245 110 Q240 45 300 40 Q360 45 355 110 L400 140 L475 360 L425 380 L375 245 L385 620 L215 620 L225 245 L175 380 L125 360 L200 140 Z'
    : 'M245 110 Q300 155 355 110 L405 140 L480 250 L415 290 L380 235 L390 610 L210 610 L220 235 L185 290 L120 250 L195 140 Z';
}
export function renderDesign(project, side = 'front', guides = false) {
  const d = project.design;
  const layer = d.sides[side];
  const path = garmentPath(d.garment);
  const fontSize = Math.max(12, Math.min(48, layer.width / Math.max(layer.text.length * .6, 3)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700" role="img" aria-label="${escapeXML(project.name)} — ${side} technical design sketch">
  <defs><clipPath id="garment"><path d="${path}"/></clipPath></defs>
  <rect width="600" height="700" fill="#edeae4"/>
  <path d="${path}" fill="${d.color}" stroke="#8a8883" stroke-width="2"/>
  ${d.garment === 'hoodie' ? '<path d="M260 115 Q300 75 340 115 M300 110 L300 175 M250 470 L350 470 L365 545 L235 545 Z" fill="none" stroke="#8a8883" stroke-width="2"/>' : '<path d="M245 110 Q300 170 355 110" fill="none" stroke="#8a8883" stroke-width="2"/>'}
  <g clip-path="url(#garment)"><g transform="translate(${layer.x} ${layer.y}) rotate(${layer.rotation})">
  ${layer.artwork ? `<image href="${escapeXML(layer.artwork)}" x="${-layer.width/2}" y="${-layer.width/2}" width="${layer.width}" height="${layer.width}" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <text text-anchor="middle" y="${layer.artwork ? layer.width/2 + 22 : 0}" fill="${layer.ink}" font-family="Arial,sans-serif" font-weight="700" font-size="${fontSize}">${escapeXML(layer.text)}</text>
  </g></g>
  ${guides ? '<rect x="210" y="195" width="180" height="350" fill="none" stroke="#b49058" stroke-dasharray="5 7"/><path d="M300 180 V560" stroke="#b49058" stroke-dasharray="3 8"/>' : ''}
  <text x="300" y="665" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" letter-spacing="3" fill="#54534e">${side.toUpperCase()} / ASRYO DESIGN STUDY</text>
  </svg>`;
}

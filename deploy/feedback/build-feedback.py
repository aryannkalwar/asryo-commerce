from pathlib import Path
import base64
import json
root = Path(__file__).resolve().parent
public = root.parent.parent / 'public' / 'assets'
pages = {'/about.html': (root/'about.html').read_text(), '/vote': (root/'vote.html').read_text(), '/vote-client.js': (root/'vote-client.js').read_text()}
assets = {'/assets/'+name: base64.b64encode((public/name).read_bytes()).decode() for name in ['asryo-speed-division-front.webp','asryo-dream-front.webp','shadowbound-front.webp']}
(root/'worker.mjs').write_text("import storefront from './storefront-original.mjs';\nconst pages="+json.dumps(pages,ensure_ascii=False)+";\nconst assets="+json.dumps(assets)+";\n"+(root/'handler.mjs').read_text())

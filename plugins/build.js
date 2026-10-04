// Builds the single-file plugins: src/<name>.js (+ jolt.b64 for physics) -> <name>.js
const fs = require('fs'), path = require('path');
const dir = __dirname;
for (const name of fs.readdirSync(path.join(dir, 'src')).filter(f => f.endsWith('.js'))) {
	let code = fs.readFileSync(path.join(dir, 'src', name), 'utf8');
	if (code.includes('__JOLT_SOURCE__')) {
		const jolt = fs.readFileSync(path.join(dir, 'jolt.b64'), 'utf8').trim();
		code = code.replace('"__JOLT_SOURCE__"', () => "'" + jolt + "'");
	}
	fs.writeFileSync(path.join(dir, name), code);
	console.log('built', name, Math.round(code.length / 1024) + ' KB');
}

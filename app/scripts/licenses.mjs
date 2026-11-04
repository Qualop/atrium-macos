import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
// Copy notices from installed runtime packages without importing their code.
export function copyRuntimeLicenses(roots, destination) {
  const queue = roots.map(root => ({root, include: false})), seen = new Set(), records = [];
  while (queue.length) {
    const {root, include} = queue.shift();
    if (seen.has(root)) continue; seen.add(root);
    const manifest = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (include) {
      const folder = path.join(destination, `${pkg.name.replaceAll('/', '__')}@${pkg.version}`);
      const files = fs.readdirSync(root, {withFileTypes: true}).filter(f => f.isFile() && /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(f.name));
      if (files.length) fs.mkdirSync(folder, {recursive: true});
      for (const file of files) fs.copyFileSync(path.join(root, file.name), path.join(folder, file.name));
      records.push({name: pkg.name, version: pkg.version, license: pkg.license || null, notices: files.map(f=>f.name)});
    }
    const req = createRequire(manifest);
    for (const name of new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})])) {
      const base = (req.resolve.paths(name) || []).map(dir=>path.join(dir,name)).find(dir=>fs.existsSync(path.join(dir,'package.json')));
      if (base) queue.push({root: fs.realpathSync(base), include: true});
    }
  }
  fs.mkdirSync(destination, {recursive: true});
  fs.writeFileSync(path.join(destination,'index.json'), JSON.stringify(records.sort((a,b)=>a.name.localeCompare(b.name)),null,2)+'\n');
  return records;
}

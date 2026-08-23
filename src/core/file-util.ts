import * as fs from 'fs';
import * as path from 'path';

const GQL_DIR = path.resolve(__dirname, '../../resources/GQL');

export function readQuery(fileName: string): string {
  const raw = fs.readFileSync(path.join(GQL_DIR, fileName), 'utf-8');
  return JSON.parse(raw).query;
}

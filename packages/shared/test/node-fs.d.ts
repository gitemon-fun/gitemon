// the credits test reads the repo's files; this package has no Node types, so just what it uses
declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

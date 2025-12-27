declare module 'yargs/yargs' {
  import yargs from 'yargs';
  export default yargs;
}

declare module 'yargs/helpers' {
  export function hideBin(argv: string[]): string[];
}



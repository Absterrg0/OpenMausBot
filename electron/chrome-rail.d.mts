export declare const CHROME_RAIL_WIDTH: number;
export declare const CHROME_RAIL_PATH: string;
export interface ChromeRail {
  attach(window: unknown): void;
  refresh(): void;
  expand(on: boolean): void;
  owns(event: unknown): boolean;
  shown(): boolean;
  expanded(): boolean;
  send(channel: string, ...values: unknown[]): void;
  install(ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void }): void;
}
export declare function createChromeRail(deps: {
  createView: (options: object) => any;
  preload: string;
  args: () => string[];
  url: () => string;
  wanted: () => boolean;
  log?: (line: string) => void;
}): ChromeRail;

export type StakeholderCsvRow = Record<string, string | boolean | null | undefined>;
export declare const profileCsvColumns: ReadonlyArray<readonly [string, string]>;
export declare function csvCell(value: string | boolean | null | undefined): string;
export declare function profilesCsv(profiles: StakeholderCsvRow[]): string;

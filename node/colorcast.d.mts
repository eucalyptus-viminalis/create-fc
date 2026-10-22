// Types for colorcast.mjs, which clearcast imports from TypeScript.
export declare const COLORS: readonly string[];
export declare function nameHolder(name: string, fid?: number): Promise<"free" | "yours" | "taken">;
export declare function pickColorcast(o?: { fid?: number; log?: (s: string) => void; tries?: number }): Promise<string | undefined>;

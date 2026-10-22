// Types for fameboy-name.mjs, which fameboy imports from TypeScript.
export declare const PALETTE: Readonly<Record<string, string>>;
export declare const COLORS: readonly string[];
export declare const PREFIX: "fameboy";
export declare function colorOf(name: string | undefined): { color: string; hex: string } | undefined;
export declare function nameHolder(name: string, fid?: number): Promise<"free" | "yours" | "taken">;
export declare function pickFameboyName(o?: { fid?: number; log?: (s: string) => void; tries?: number }): Promise<string | undefined>;

import { describe, expect, it } from "vitest";
import { symbolFontText } from "./symbolFonts";

describe("symbolFontText", () => {
  it("shows a Webdings 'a' as the checkmark Excel draws (KPMR 'PSP LSB' column)", () => {
    expect(symbolFontText("a", "Webdings")).toBe("✓");
  });

  it("leaves text in ordinary fonts, and unmapped symbol characters, alone", () => {
    expect(symbolFontText("a", "Calibri")).toBe("a");
    expect(symbolFontText("a", undefined)).toBe("a");
    expect(symbolFontText("z", "Webdings")).toBe("z");
  });
});

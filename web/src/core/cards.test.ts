import { describe, expect, it } from "vitest";
import { cardToString, cardToSymbol, isRed, parseCard, parseCards } from "./cards";

describe("cards", () => {
  it("uses the same encoding as the Rust core", () => {
    expect(parseCard("2c")).toBe(0);
    expect(parseCard("As")).toBe(51);
    expect(parseCard("Td")).toBe(33);
  });

  it("round-trips every card", () => {
    for (let c = 0; c < 52; c++) {
      expect(parseCard(cardToString(c))).toBe(c);
    }
  });

  it("parses lists with or without separators", () => {
    expect(parseCards("As Kd")).toEqual([51, 45]);
    expect(parseCards("AsKd")).toEqual([51, 45]);
    expect(parseCards("as, kd")).toEqual([51, 45]);
    expect(parseCards("")).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => parseCard("Ax")).toThrow();
    expect(() => parseCard("1s")).toThrow();
    expect(() => parseCards("AsK")).toThrow();
    expect(() => parseCards("As As")).toThrow();
  });

  it("formats for display", () => {
    expect(cardToSymbol(51)).toBe("A♠");
    expect(isRed(parseCard("Kh"))).toBe(true);
    expect(isRed(parseCard("Kc"))).toBe(false);
  });
});

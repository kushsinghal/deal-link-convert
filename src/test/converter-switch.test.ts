import { describe, expect, it } from "vitest";
import { converterChain } from "@/server/engine.server";

describe("converter on/off", () => {
  const base = { extrape_token: "a", earnkaro_token: "b", tg_session: "c", converter_order: ["extrape", "earnkaro", "sankmo"] };
  it("a switched-off converter is never used, even as backup", () => {
    expect(converterChain({ ...base, converter_disabled: ["earnkaro"] })).toEqual(["extrape", "sankmo"]);
    expect(converterChain({ ...base, converter_disabled: ["extrape", "earnkaro"] })).toEqual(["sankmo"]);
  });
  it("order still decides who goes first", () => {
    expect(converterChain({ ...base, converter_order: ["sankmo", "extrape", "earnkaro"] })).toEqual(["sankmo", "extrape", "earnkaro"]);
  });
});

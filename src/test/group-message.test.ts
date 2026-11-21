import { expect, test } from "vitest";
import { formatGroupMessage } from "@/server/engine.server";
test("group", () => {
  const m = formatGroupMessage([{ post_title: "Gold <Deal>", title: "Gold <Deal> (1/2)", affiliate_url: "https://a/1" }, { post_title: "Gold <Deal>", title: "Coin 2g", price: 11250, affiliate_url: "https://a/2" }]);
  console.log(m);
  expect(m).toContain("1.\nhttps://a/1"); expect(m).toContain("Coin 2g"); expect(m).toContain("&lt;Deal&gt;");
});

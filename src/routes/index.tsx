import { createFileRoute } from "@tanstack/react-router";
import DealsPage from "@/views/DealsPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DealLoot — Shopping offers and buying guides" },
      { name: "description", content: "Reviewed shopping offers and practical buying guides for India. Understand prices, rewards and offer conditions before buying." },
      { property: "og:title", content: "DealLoot — Shopping offers and buying guides" },
      { property: "og:description", content: "Shopping offers with original buying advice. Compare the conditions before you buy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DealsPage,
});

import { Inngest } from "inngest";

// Create an Inngest client
export const inngest = new Inngest({
  id: "connectplus",
  name: "ConnectPlus",
});

export type { Inngest } from "inngest";
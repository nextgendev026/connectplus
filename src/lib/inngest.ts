import { Inngest } from "inngest";

// Create an Inngest client
export const inngest = new Inngest({
  id: "connectplus",
  name: "ConnectPlus",
  signingKey: process.env.INNGEST_SIGN_KEY,
});

export type { Inngest } from "inngest";
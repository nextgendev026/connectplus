#!/usr/bin/env node
/**
 * Generate the VAPID key pair for web push.
 *
 * Push needs a key pair that identifies this server to the browsers' push
 * services. Both halves are required: with only the public key the browser will
 * happily create a subscription and the server can never sign a request, so
 * alerts look configured and never arrive — the worst of both.
 *
 * Run this once per environment and paste the output into the environment:
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Then set (locally in `.env`, and in the host's env for production):
 *   NEXT_PUBLIC_VAPID_KEY=<public key>
 *   VAPID_PRIVATE_KEY=<private key>
 *   VAPID_SUBJECT=mailto:you@example.com
 *
 * The public key is safe in a client bundle and MUST be prefixed NEXT_PUBLIC_ so
 * Next inlines it. The private key is a credential: never commit it.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("");
console.log("VAPID key pair generated. Add these to your environment:");
console.log("");
console.log(`NEXT_PUBLIC_VAPID_KEY="${publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${privateKey}"`);
console.log('VAPID_SUBJECT="mailto:you@example.com"');
console.log("");
console.log("Rotating these keys invalidates every existing subscription:");
console.log("readers simply re-subscribe the next time they open the site.");
console.log("");

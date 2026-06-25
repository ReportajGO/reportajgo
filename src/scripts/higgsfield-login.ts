// One-time interactive login to Higgsfield's MCP (authorization_code + PKCE).
// Produces a stored refresh token the autonomous agent uses headlessly.
//   npm run higgsfield:login
import { interactiveLogin } from "../integrations/higgsfield/oauth.js";

interactiveLogin()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Login failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

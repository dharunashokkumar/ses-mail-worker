import { EmailExplorer } from "../packages/worker/src";

export { MailboxDO } from "../packages/worker/src";

// Smart mode: the first user to register becomes admin, then registration closes.
export default EmailExplorer({
	auth: {
		enabled: true,
	},
});

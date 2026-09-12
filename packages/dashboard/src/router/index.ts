import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import Admin from "@/views/Admin.vue";
import ForgotPassword from "@/views/ForgotPassword.vue";
import Login from "@/views/Login.vue";
import MailView from "@/views/MailView.vue";
import NotFound from "@/views/NotFound.vue";
import Register from "@/views/Register.vue";
import ResetPassword from "@/views/ResetPassword.vue";

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes: [
		{
			path: "/login",
			name: "Login",
			component: Login,
			meta: { title: "Sign in", public: true },
		},
		{
			path: "/register",
			name: "Register",
			component: Register,
			meta: { title: "Register", public: true },
		},
		{
			path: "/forgot-password",
			name: "ForgotPassword",
			component: ForgotPassword,
			meta: { title: "Forgot password", public: true },
		},
		{
			path: "/reset-password",
			name: "ResetPassword",
			component: ResetPassword,
			meta: { title: "Reset password", public: true },
		},
		{
			path: "/admin",
			name: "Admin",
			component: Admin,
			meta: { title: "Admin", requiresAuth: true, requiresAdmin: true },
		},
		{
			path: "/",
			redirect: { name: "Mail" },
		},
		{
			path: "/mail/:mailboxId?/:folder?",
			name: "Mail",
			component: MailView,
			meta: { requiresAuth: true },
		},
		// Links from the previous dashboard keep working.
		{
			path: "/mailbox/:mailboxId/emails/:folder",
			redirect: (to) => ({
				name: "Mail",
				params: { mailboxId: to.params.mailboxId, folder: to.params.folder },
			}),
		},
		{
			path: "/mailbox/:mailboxId/email/:id",
			redirect: (to) => ({
				name: "Mail",
				params: { mailboxId: to.params.mailboxId, folder: "inbox" },
				query: { thread: String(to.params.id) },
			}),
		},
		{
			path: "/mailbox/:mailboxId/:rest(.*)?",
			redirect: (to) => ({
				name: "Mail",
				params: { mailboxId: to.params.mailboxId, folder: "inbox" },
			}),
		},
		{
			path: "/:pathMatch(.*)*",
			name: "NotFound",
			component: NotFound,
			meta: { title: "Not found" },
		},
	],
});

/**
 * Ask the server whether this browser is already authenticated.
 *
 * Behind Cloudflare Access there is no app session to inspect — Access has
 * authenticated the request at the edge — so an answer from `/api/v1/identity`
 * is the proof. The same check covers a deployment with auth switched off.
 */
let serverAuth: boolean | null = null;

async function authenticatedByServer(): Promise<boolean> {
	if (serverAuth !== null) return serverAuth;
	try {
		const response = await fetch("/api/v1/identity");
		serverAuth = response.ok;
	} catch {
		serverAuth = false;
	}
	return serverAuth;
}

router.beforeEach(async (to, _from, next) => {
	const authStore = useAuthStore();
	const isPublicRoute = to.meta.public === true;
	const requiresAuth = to.meta.requiresAuth === true;
	const requiresAdmin = to.meta.requiresAdmin === true;

	if (authStore.session && authStore.session.expiresAt < Date.now()) {
		await authStore.logout();
	}

	const authenticated =
		authStore.isAuthenticated || (await authenticatedByServer());

	if (requiresAuth && !authenticated) {
		next({ name: "Login", query: { redirect: to.fullPath } });
		return;
	}
	if (requiresAdmin && !authStore.isAdmin && !(await authenticatedByServer())) {
		next({ name: "Mail" });
		return;
	}
	if (
		isPublicRoute &&
		authStore.isAuthenticated &&
		to.name !== "ResetPassword"
	) {
		next({ name: "Mail" });
		return;
	}
	next();
});

router.afterEach((to) => {
	document.title = to.meta.title ? `${to.meta.title} · Mail` : "Mail";
});

export default router;

// This console is linked from Notion, never embedded. Prevent framed controls
// on the static host, where response-level frame-ancestors is unavailable.
if (window.self !== window.top) {
  const link = document.createElement("a");
  link.href = "https://getforth.github.io/forth-legal/room-review/";
  link.target = "_blank"; link.rel = "noopener noreferrer";
  link.textContent = "Open Room review in a new tab";
  document.body.replaceChildren(link);
  throw new Error("Room review must be opened directly.");
}
const ENDPOINT = "https://gwwiwljuemiuumnqipbv.supabase.co/functions/v1/room-review";
const SESSION_KEY = "forth.room-review.session";
const CHALLENGE_KEY = "forth.room-review.challenge";
const $ = (id) => document.getElementById(id);
let session = null, challenge = null, queue = null, selected = null, filter = "all";
let loading = false, acting = false, pendingDecision = null, loadVersion = 0;
function saved(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }
function save(key, value) { try { value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key); } catch { /* Sign-in still works for this page visit. */ } }
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function message(id, text = "", error = false) { $(id).textContent = text; $(id).classList.toggle("error", error); }
function date(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function deadline(value) {
  const minutes = Math.ceil((Date.parse(value) - Date.now()) / 60000);
  if (minutes <= 0) return "Overdue";
  return minutes < 60 ? `Due in ${minutes}m` : `Due in ${Math.ceil(minutes / 60)}h`;
}
function clearSession(note = "") {
  session = null; queue = null; selected = null; pendingDecision = null; loadVersion++;
  save(SESSION_KEY, null); $("confirm-dialog").close(); $("post-list").replaceChildren(); $("detail").replaceChildren();
  $("workspace").hidden = true; $("logout").hidden = true; $("login").hidden = false;
  message("login-message", note);
}
async function api(body, authorized = true) {
  const headers = { "Content-Type": "application/json" };
  if (authorized && session) headers.Authorization = `Bearer ${session.token}`;
  let response;
  try { response = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(25000) }); }
  catch { throw new Error("Couldn’t connect. Check your connection and try again."); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (authorized && response.status === 401) clearSession("Your session ended. Sign in again to continue.");
    const error = new Error(result.error || "Couldn’t complete that request. Please try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}
function showChallenge() {
  $("code-form").hidden = !challenge;
  $("send-code").textContent = challenge ? "Send another code" : "Send sign-in code →";
}
$("send-code").addEventListener("click", async () => {
  const button = $("send-code"); button.disabled = true;
  message("login-message", "Sending your code…");
  try {
    const data = await api({ action: "request_code" }, false);
    challenge = { id: data.challenge, expiresAt: Date.now() + 600000 }; save(CHALLENGE_KEY, challenge);
    showChallenge(); $("code").value = ""; $("code").focus(); message("login-message", "Code sent. Check your inbox or Spam folder.");
  } catch (error) { message("login-message", error.message, true); }
  finally { button.disabled = false; }
});
$("code-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!challenge) return;
  const button = $("code-form").querySelector("button"); button.disabled = true;
  message("login-message", "Signing in…");
  try {
    const data = await api({ action: "verify_code", challenge: challenge.id, code: $("code").value.trim() }, false);
    session = { token: data.access_token, expiresAt: Date.now() + Math.min(Number(data.expires_in) || 3600, 3600) * 1000 };
    save(SESSION_KEY, session); save(CHALLENGE_KEY, null); challenge = null; $("code").value = ""; showChallenge();
    await enterWorkspace();
  } catch (error) { message("login-message", error.message, true); }
  finally { button.disabled = false; }
});
async function enterWorkspace() {
  $("login").hidden = true; $("workspace").hidden = false; $("logout").hidden = false;
  message("workspace-message"); await loadQueue();
}
function visibleItems() {
  return (queue?.items || []).filter(item => filter === "all" || (filter === "reported" ? item.reports.length > 0 : item.status === "pending"));
}
function renderList() {
  const list = $("post-list"); list.replaceChildren();
  $("total").textContent = queue.total; $("overdue").textContent = queue.overdue;
  $("overdue-label").classList.toggle("is-overdue", queue.overdue > 0);
  $("limit-note").textContent = queue.total > queue.items.length ? `Showing the oldest ${queue.items.length} of ${queue.total}. More appear as you review.` : "";
  const items = visibleItems();
  if (!items.some(item => item.id === selected)) selected = items[0]?.id || null;
  if (!items.length) list.append(el("p", "list-placeholder", queue.total ? "No posts in this filter." : "Nothing waiting for review."));
  items.forEach(item => {
    const button = el("button", "post-row"); button.type = "button"; button.setAttribute("aria-current", String(item.id === selected));
    const top = el("div", "row-top"); top.append(el("span", "", item.handle), el("span", "small muted", item.status === "pending" ? "Held" : "Reported"));
    const bottom = el("div", "row-bottom"); bottom.append(el("span", "", item.reports.length ? `${item.reports.length} report${item.reports.length === 1 ? "" : "s"}` : "Automatic check"), el("span", Date.parse(item.review_due_at) < Date.now() ? "due-overdue" : "", deadline(item.review_due_at)));
    button.append(top, el("p", "row-body", item.body), bottom);
    button.addEventListener("click", () => { selected = item.id; renderList(); renderDetail(); if (matchMedia("(max-width:650px)").matches) $("detail").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "instant" : "smooth", block: "start" }); });
    list.append(button);
  });
}
function actionButton(label, decision, item, className) {
  const button = el("button", className, label); button.disabled = acting;
  button.addEventListener("click", () => {
    if (decision === "remove" || decision === "eject") {
      pendingDecision = { item, decision };
      $("confirm-title").textContent = decision === "eject" ? "Remove this author from the Room?" : "Remove this post?";
      $("confirm-description").textContent = decision === "eject"
        ? `All posts by ${item.handle} will be removed, and this Room identity will lose access. Use this for confirmed abuse. A concern about someone’s wellbeing alone is not a reason to remove them.`
        : "This post will leave the feed and its reports will be resolved. The author can still use the Room.";
      $("confirm-action").textContent = decision === "eject" ? "Remove & ban author" : "Remove post";
      $("confirm-dialog").showModal(); $("cancel-action").focus();
    } else void decide(item, decision);
  });
  return button;
}
function renderDetail() {
  const detail = $("detail"); detail.replaceChildren();
  const item = queue?.items.find(value => value.id === selected);
  if (!item) {
    const empty = el("div", "empty");
    empty.append(el("div", "empty-mark", "✓"), el("h2", "", queue?.total ? "This filter is clear" : "You’re all caught up"), el("p", "", queue?.total ? "Choose another filter to see the rest of the queue." : "New reports and held posts will appear here. We’ll email you when something needs review.")); detail.append(empty); return;
  }
  const heading = el("div", "detail-heading"), title = el("div");
  title.append(el("h2", "", item.handle), el("p", "post-meta", `Posted ${date(item.created_at)} · Review by ${date(item.review_due_at)}`));
  heading.append(title, el("span", "status-tag", item.status === "pending" ? "Not published" : item.status === "published" ? "Published" : "Already hidden")); detail.append(heading);
  if (item.parent) { const parent = el("div", "parent"); parent.append(el("strong", "", `Replying to ${item.parent.handle}`), el("p", "", item.parent.body)); detail.append(parent); }
  detail.append(el("p", "post-body", item.body));
  const context = el("div", "review-context");
  context.append(el("h3", "section-label", "Why it needs review"));
  if (item.reports.length) item.reports.forEach(report => { const reason = el("p", "reason", report.reason); reason.append(el("small", "", `Reported ${date(report.reported_at)}`)); context.append(reason); });
  if (item.status === "pending") {
    context.append(el("p", "hold-note", item.moderation_reason ? `Automatic check: ${item.moderation_reason}` : "The automatic check held this post for a person to review. An earlier build did not save the reason."));
  }
  if (item.moderation_verdict === "crisis" || item.moderation_category === "self_harm") context.append(el("p", "safety-note", "Wellbeing concern. The app showed crisis resources. Needing help is not abuse; do not ban someone for that alone."));
  if (Date.parse(item.expires_at) <= Date.now()) context.append(el("p", "hold-note", "This post has expired from the feed. Its evidence remains here until reviewed."));
  if (item.ejected_at) context.append(el("p", "hold-note", "This author’s Room access has already been removed."));
  detail.append(context);
  const actions = el("div", "detail-actions");
  if (item.status === "pending" && !item.ejected_at && Date.parse(item.expires_at) > Date.now()) actions.append(actionButton("Approve post", "approve", item, "primary"));
  if (item.reports.length) actions.append(actionButton("Dismiss reports", "dismiss", item, "secondary"));
  if (item.status !== "removed") actions.append(actionButton("Remove post", "remove", item, "secondary"));
  if (!item.ejected_at) actions.append(actionButton("Remove & ban author", "eject", item, "secondary danger-subtle"));
  detail.append(actions, el("p", "action-description", "Approve publishes a held post. Dismiss closes reports without changing the post. For confirmed abusive users, remove their Room access too."));
}
async function loadQueue() {
  if (!session || loading || acting || $("confirm-dialog").open) return;
  if (session.expiresAt <= Date.now()) { clearSession("Your session ended. Sign in again to continue."); return; }
  loading = true; $("refresh").disabled = true;
  const version = ++loadVersion;
  try {
    const data = await api({ action: "queue" });
    if (version !== loadVersion || !session) return;
    if (!Array.isArray(data.items) || typeof data.total !== "number") throw new Error("Couldn’t read the queue. Please refresh.");
    queue = data; renderList(); renderDetail();
    $("freshness").textContent = `Updated ${new Date(data.checked_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  } catch (error) {
    if (session) {
      message("workspace-message", error.message, true); $("freshness").textContent = "Refresh failed";
      if (!queue) { $("post-list").replaceChildren(el("p", "list-placeholder", "Queue unavailable.")); const empty = el("div", "empty"); empty.append(el("h2", "", "Couldn’t load the queue"), el("p", "", "Use Refresh to try again. Your review actions have not changed.")); $("detail").replaceChildren(empty); }
    }
  } finally { loading = false; $("refresh").disabled = false; }
}
async function decide(item, decision) {
  if (acting || !session) return;
  acting = true; renderDetail(); message("workspace-message", "Saving your decision…");
  try {
    await api({ action: "decide", post_id: item.id, revision: item.revision, decision });
    message("workspace-message", ({ approve: "Post approved.", dismiss: "Reports dismissed.", remove: "Post removed.", eject: "Author removed from the Room. Their posts have been removed." })[decision]);
    selected = null;
  } catch (error) { if (session) message("workspace-message", error.message, true); }
  finally { acting = false; if (session) await loadQueue(); }
}
$("cancel-action").addEventListener("click", () => { pendingDecision = null; $("confirm-dialog").close(); });
$("confirm-action").addEventListener("click", () => { const pending = pendingDecision; pendingDecision = null; $("confirm-dialog").close(); if (pending) void decide(pending.item, pending.decision); });
$("confirm-dialog").addEventListener("cancel", () => { pendingDecision = null; });
$("refresh").addEventListener("click", () => { message("workspace-message"); void loadQueue(); });
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => { filter = button.dataset.filter; document.querySelectorAll("[data-filter]").forEach(other => other.setAttribute("aria-pressed", String(other === button))); if (queue) { renderList(); renderDetail(); } }));
$("logout").addEventListener("click", async () => {
  $("logout").disabled = true;
  try { await api({ action: "logout" }); clearSession("You’re signed out."); }
  catch (error) { if (session) message("workspace-message", error.message, true); }
  finally { $("logout").disabled = false; }
});
session = saved(SESSION_KEY); challenge = saved(CHALLENGE_KEY);
if (!session?.token || !session.expiresAt || session.expiresAt <= Date.now()) { session = null; save(SESSION_KEY, null); }
if (!challenge?.id || challenge.expiresAt <= Date.now()) { challenge = null; save(CHALLENGE_KEY, null); }
showChallenge(); if (session) void enterWorkspace();
setInterval(() => {
  if (session && session.expiresAt <= Date.now()) clearSession("Your session ended. Sign in again to continue.");
  else if (!document.hidden && session) void loadQueue();
}, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && session) void loadQueue(); });
window.addEventListener("pagehide", () => { queue = null; $("post-list").replaceChildren(); $("detail").replaceChildren(); });
window.addEventListener("pageshow", event => { if (event.persisted && session) void loadQueue(); });

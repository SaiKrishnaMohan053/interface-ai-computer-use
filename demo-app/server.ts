import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { findMember, formatBalance, getMemberAccounts, searchMemberByName } from './data.js';
import type { Member, SubAccount } from './types.js';
import { evaluateScenario } from './scenario-controller.js';
import type { ScenarioDecision } from './scenario-controller.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function memberPath(member: Member): string {
  return `/member/${encodeURIComponent(member.id)}`;
}

function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Demo Credit Union</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #e8ebee;
      color: #182431;
      font: 16px Arial, sans-serif;
    }
    header {
      padding: 18px 28px;
      background: #17334d;
      color: white;
    }
    header strong { font-size: 22px; }
    header p { margin-bottom: 0; font-size: 14px; }
    nav {
      padding: 14px 28px;
      background: #d4dce3;
      border-bottom: 1px solid #aab8c4;
    }
    main {
      max-width: 1000px;
      margin: 28px auto;
      padding: 28px;
      background: white;
      border: 1px solid #b8c2cc;
    }
    a { color: #174d7a; }
    h1 { margin-top: 0; font-size: 26px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    caption {
      text-align: left;
      font-weight: bold;
      padding: 10px 0;
    }
    th, td {
      padding: 12px;
      border: 1px solid #bec7cf;
      text-align: left;
    }
    th { background: #e6ecf1; }
    .legacy-panel {
      border: 2px solid #9caeba;
      background: #f5f7f9;
    }
    .legacy-panel td { vertical-align: top; }
    .legacy-panel table { margin: 0; }
    .legacy-panel table td { border: 0; }
    label {
      display: block;
      margin: 18px 0 7px;
      font-weight: bold;
    }
    input, select {
      padding: 10px;
      width: 100%;
      max-width: 420px;
      font: inherit;
      border: 1px solid #788c9c;
    }
    button {
      display: block;
      margin-top: 22px;
      padding: 11px 20px;
      font: inherit;
      background: #174d7a;
      color: white;
      border: 0;
      cursor: pointer;
    }
    :focus-visible {
      outline: 3px solid #c47700;
      outline-offset: 3px;
    }
    .notice {
      padding: 14px;
      background: #fff4d6;
      border: 1px solid #d8bd6c;
    }
    .table-scroll { overflow-x: auto; }
    dt { margin-top: 16px; font-weight: bold; }
    dd { margin: 6px 0 0; }
    footer {
      padding: 20px;
      text-align: center;
      color: #536373;
    }
    @media (max-width: 700px) {
      main { margin: 12px; padding: 18px; }
    }
  </style>
</head>
<body>
  <header>
    <strong>Demo Credit Union</strong>
    <p>Staff servicing console | Local demonstration</p>
  </header>
  <nav aria-label="Primary navigation">
    <a href="/member-search">Member Search</a>
  </nav>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${content}
  </main>
  <footer data-surface-ready="true">
  Fictional members only. No real banking transactions.
</footer>
</body>
</html>`;
}

function sendHtml(response: ServerResponse, status: number, title: string, content: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
  });

  response.end(layout(title, content));
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendHtml(
    response,
    status,
    code,
    `<div role="alert">
      <p>${escapeHtml(message)}</p>
    </div>
    <p><a href="/member-search">Return to Member Search</a></p>`,
  );
}

function redirect(response: ServerResponse, destination: string): void {
  response.writeHead(302, { Location: destination });
  response.end();
}

function renderSearch(response: ServerResponse): void {
  sendHtml(
    response,
    200,
    'Member Search',
    `<p>Enter the member's full name to open their servicing record.</p>
    <form method="get" action="/member-search">
      <label for="member-name">Member Name</label>
      <input
        id="member-name"
        name="memberName"
        type="text"
        maxlength="100"
        required
        autocomplete="off"
      >
      <button type="submit">Search</button>
    </form>
    <p>Demo member: <strong>Alex Morgan</strong></p>`,
  );
}

function handleSearch(response: ServerResponse, url: URL): void {
  const names = url.searchParams.getAll('memberName');

  if (names.length === 0) {
    renderSearch(response);
    return;
  }

  if (names.length !== 1) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide exactly one member name.');
    return;
  }

  const result = searchMemberByName(names[0] ?? '');

  switch (result.kind) {
    case 'invalid_input':
      sendError(response, 400, 'INVALID_INPUT', 'Enter a member name of 1 to 100 characters.');
      return;
    case 'not_found':
      sendError(response, 404, 'MEMBER_NOT_FOUND', 'No matching member was found.');
      return;
    case 'ambiguous':
      sendError(
        response,
        409,
        'MEMBER_AMBIGUOUS',
        'Multiple members have this name. Additional identification is required. No record was selected.',
      );
      return;
    case 'found':
      redirect(response, memberPath(result.member));
      return;
  }
}

function renderDetails(response: ServerResponse, member: Member): void {
  const base = memberPath(member);

  sendHtml(
    response,
    200,
    'Member Details',
    `<table class="legacy-panel" role="presentation">
      <tbody>
        <tr>
          <td>
            <strong>Member record</strong>
            <table role="presentation">
              <tbody>
                <tr><td>Name</td><td>${escapeHtml(member.displayName)}</td></tr>
                <tr><td>Member ID</td><td>${escapeHtml(member.id)}</td></tr>
                <tr><td>Status</td><td>Active</td></tr>
              </tbody>
            </table>
          </td>
          <td>
            <strong>Servicing links</strong>
            <p><a href="${base}/accounts">Accounts</a></p>
            <p><a href="${base}/subaccounts/new">Open Sub-account</a></p>
          </td>
        </tr>
      </tbody>
    </table>`,
  );
}

function renderAccounts(response: ServerResponse, member: Member): void {
  const memberAccounts = getMemberAccounts(member.id);

  const rows = memberAccounts
    .map(
      (account) => `<tr>
        <td>${escapeHtml(account.id)}</td>
        <td>${escapeHtml(account.type)}</td>
        <td>${escapeHtml(account.status)}</td>
        <td>${escapeHtml(formatBalance(account))}</td>
      </tr>`,
    )
    .join('');

  sendHtml(
    response,
    200,
    'Member Accounts',
    `<p>Member: ${escapeHtml(member.displayName)}</p>
    <div class="table-scroll">
      <table>
        <caption>Accounts</caption>
        <thead>
          <tr>
            <th scope="col">Account Number</th>
            <th scope="col">Account Type</th>
            <th scope="col">Status</th>
            <th scope="col">Current Balance</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${memberAccounts.length === 0 ? '<p>No accounts are available.</p>' : ''}
    <p><a href="${memberPath(member)}">Member Details</a></p>
    <p><a href="${memberPath(member)}/subaccounts/new">Open Sub-account</a></p>`,
  );
}

function renderSubAccountForm(response: ServerResponse, member: Member): void {
  const openAccounts = getMemberAccounts(member.id).filter((account) => account.status === 'Open');

  if (openAccounts.length === 0) {
    sendError(
      response,
      409,
      'NO_ELIGIBLE_ACCOUNT',
      'An open parent account is required to prepare a sub-account.',
    );
    return;
  }

  const options = openAccounts
    .map(
      (account) =>
        `<option value="${escapeHtml(account.id)}">` +
        `${escapeHtml(account.type)} - ${escapeHtml(account.id)}</option>`,
    )
    .join('');

  sendHtml(
    response,
    200,
    'Open Sub-account',
    `<p>Prepare a Savings sub-account for ${escapeHtml(member.displayName)}.</p>
    <form method="get" action="${memberPath(member)}/subaccounts/review">
      <label for="parent-account">Parent Account</label>
      <select id="parent-account" name="parentAccountId" required>
        <option value="">Select an account</option>
        ${options}
      </select>

      <label for="subaccount-name">Sub-account Nickname</label>
      <input
        id="subaccount-name"
        name="nickname"
        type="text"
        maxlength="40"
        required
        autocomplete="off"
      >

      <p>Account Type: Savings</p>
      <button type="submit">Review Sub-account</button>
    </form>
    <p><a href="${memberPath(member)}/accounts">Accounts</a></p>`,
  );
}

function renderReview(response: ServerResponse, member: Member, url: URL): void {
  const parentIds = url.searchParams.getAll('parentAccountId');
  const nicknames = url.searchParams.getAll('nickname');

  if (parentIds.length !== 1 || nicknames.length !== 1) {
    sendError(response, 400, 'INVALID_INPUT', 'Provide exactly one parent account and nickname.');
    return;
  }

  const parentAccountId = parentIds[0] ?? '';
  const rawNickname = nicknames[0] ?? '';
  const nickname = rawNickname.trim();

  const parent = getMemberAccounts(member.id).find(
    (account) => account.id === parentAccountId && account.status === 'Open',
  );

  if (!parent || nickname.length === 0 || rawNickname.length > 40) {
    sendError(
      response,
      400,
      'INVALID_INPUT',
      'Choose an open parent account and enter a nickname of 1 to 40 characters.',
    );
    return;
  }

  const draft: SubAccount = {
    memberId: member.id,
    parentAccountId: parent.id,
    nickname,
    type: 'Savings',
    status: 'DRAFT',
  };

  sendHtml(
    response,
    200,
    'Review Sub-account',
    `<div class="notice">Review only. No sub-account has been created.</div>
    <dl>
      <dt>Member</dt><dd>${escapeHtml(member.displayName)}</dd>
      <dt>Parent Account</dt><dd>${escapeHtml(draft.parentAccountId)}</dd>
      <dt>Nickname</dt><dd>${escapeHtml(draft.nickname)}</dd>
      <dt>Account Type</dt><dd>${escapeHtml(draft.type)}</dd>
      <dt>Status</dt><dd>${escapeHtml(draft.status)}</dd>
    </dl>
    <p><a href="${memberPath(member)}/subaccounts/new">Back to Form</a></p>
    <p><a href="${memberPath(member)}/accounts">Accounts</a></p>`,
  );
}

function renderScenario(response: ServerResponse, decision: ScenarioDecision): boolean {
  if (decision.cookies.length > 0) {
    response.setHeader('Set-Cookie', [...decision.cookies]);
  }

  switch (decision.kind) {
    case 'proceed':
      return false;

    case 'redirect':
      redirect(response, decision.location);
      return true;

    case 'loading':
      response.setHeader('Refresh', `${decision.refreshSeconds}; url=${decision.continueUrl}`);

      sendHtml(
        response,
        200,
        'Loading',
        `<section aria-busy="true" aria-label="Application loading">
          <p role="status">Loading banking information...</p>
        </section>`,
      );
      return true;

    case 'interstitial':
      sendHtml(
        response,
        200,
        'Service Notice',
        `<section
          role="dialog"
          aria-labelledby="service-notice-title"
          aria-describedby="service-notice-description"
        >
          <h2 id="service-notice-title">Scheduled Service Notice</h2>
          <p id="service-notice-description">
            This is a known demonstration notice.
            Continue to return to the requested banking page.
          </p>
          <a href="${escapeHtml(decision.continueUrl)}">Continue</a>
        </section>`,
      );
      return true;

    case 'blocked':
      sendHtml(
        response,
        decision.status,
        decision.code,
        `<div role="alert">
          <p>${escapeHtml(decision.message)}</p>
        </div>
        <p><a href="/member-search?scenario=normal">Reset Demo Session</a></p>`,
      );
      return true;
  }
}

function routeRequest(response: ServerResponse, url: URL, cookieHeader: string): void {
  const match = /^\/member\/([0-9]{5})(\/accounts|\/subaccounts\/new|\/subaccounts\/review)?$/.exec(
    url.pathname,
  );

  const memberId = match?.[1];
  const member = memberId === undefined ? undefined : findMember(memberId);

  const decision = evaluateScenario({
    url,
    cookieHeader,
    member,
  });

  if (renderScenario(response, decision)) {
    return;
  }

  if (url.pathname === '/') {
    redirect(response, '/member-search');
    return;
  }

  if (url.pathname === '/member-search') {
    handleSearch(response, url);
    return;
  }

  if (memberId === undefined) {
    sendError(response, 404, 'PAGE_NOT_FOUND', 'The requested page does not exist.');
    return;
  }

  if (!member) {
    sendError(response, 404, 'MEMBER_NOT_FOUND', 'No matching member was found.');
    return;
  }

  switch (match?.[2]) {
    case undefined:
      renderDetails(response, member);
      return;

    case '/accounts':
      renderAccounts(response, member);
      return;

    case '/subaccounts/new':
      renderSubAccountForm(response, member);
      return;

    case '/subaccounts/review':
      renderReview(response, member, url);
      return;

    default:
      sendError(response, 404, 'PAGE_NOT_FOUND', 'The requested page does not exist.');
  }
}

export function createDemoServer(): Server {
  return createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; " +
        "base-uri 'none'; frame-ancestors 'none'",
    );

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
      return;
    }

    let url: URL;

    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1');
    } catch {
      sendError(response, 400, 'INVALID_INPUT', 'The request URL is invalid.');
      return;
    }

    try {
      routeRequest(response, url, request.headers.cookie ?? '');
    } catch {
      sendError(response, 500, 'APPLICATION_ERROR', 'The demo application could not respond.');
    }
  });
}

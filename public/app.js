let currentEmails = [];
let pollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  loadEmails();
  // Poll every 3 seconds for real-time tracking updates
  pollingInterval = setInterval(loadEmails, 3000);
});

async function loadEmails() {
  try {
    const res = await fetch('/api/emails');
    const data = await res.json();
    currentEmails = data;
    renderStats(data);
    renderEmailList(data);
  } catch (err) {
    console.error('Failed to load emails:', err);
  }
}

function renderStats(emails) {
  const total = emails.length;
  let totalOpens = 0;
  let openedEmailsCount = 0;
  let totalClicks = 0;

  emails.forEach(e => {
    totalOpens += e.openCount || 0;
    totalClicks += e.clickCount || 0;
    if (e.openCount > 0) openedEmailsCount++;
  });

  const openRate = total > 0 ? Math.round((openedEmailsCount / total) * 100) : 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-opens').textContent = totalOpens;
  document.getElementById('stat-rate').textContent = `${openRate}%`;
  document.getElementById('stat-clicks').textContent = totalClicks;
}

function renderEmailList(emails) {
  const tbody = document.getElementById('email-list-body');
  const searchVal = document.getElementById('search-input').value.toLowerCase().trim();

  const filtered = emails.filter(e => 
    e.recipient.toLowerCase().includes(searchVal) ||
    e.subject.toLowerCase().includes(searchVal)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          ${searchVal ? 'No emails matched your search.' : 'No tracked emails created yet. Click "+ Create Tracked Email" above!'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(email => {
    const isOpened = email.openCount > 0;
    const statusBadge = isOpened 
      ? `<span class="badge badge-success">✓ Opened (${email.openCount}x)</span>`
      : `<span class="badge badge-warning">⏳ Unopened</span>`;

    const formattedLastOpen = email.lastOpenedAt ? formatDate(email.lastOpenedAt) : '—';

    return `
      <tr>
        <td>${statusBadge}</td>
        <td><strong>${escapeHtml(email.recipient)}</strong></td>
        <td>${escapeHtml(email.subject)}</td>
        <td><strong>${email.openCount}</strong> opens</td>
        <td>${formattedLastOpen}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-secondary" onclick="viewEmailDetails('${email.id}')">Inspect & Copy</button>
            <button class="btn btn-sm btn-primary" onclick="simulateOpen('${email.id}')" title="Simulate recipient opening this email">Test Open</button>
            <button class="btn btn-sm btn-danger" onclick="deleteEmail('${email.id}')" title="Delete">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterEmails() {
  renderEmailList(currentEmails);
}

function openCreateModal() {
  document.getElementById('create-modal').classList.add('active');
}

function closeCreateModal() {
  document.getElementById('create-modal').classList.remove('active');
  document.getElementById('create-email-form').reset();
}

function openGmailGuideModal() {
  document.getElementById('gmail-guide-modal').classList.add('active');
}

function closeGmailGuideModal() {
  document.getElementById('gmail-guide-modal').classList.remove('active');
}

async function handleCreateEmail(event) {
  event.preventDefault();
  const recipient = document.getElementById('recipient-input').value;
  const subject = document.getElementById('subject-input').value;
  const bodyText = document.getElementById('body-input').value;
  const autoLinkTracking = document.getElementById('auto-link-tracking').checked;

  let htmlContent = bodyText;
  if (!/<[a-z][\s\S]*>/i.test(htmlContent)) {
    htmlContent = htmlContent.split('\n\n').map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  try {
    const res = await fetch('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, subject, bodyHtml: htmlContent })
    });
    const created = await res.json();

    if (autoLinkTracking && created.id) {
      const wrapRes = await fetch('/api/emails/wrap-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: created.bodyHtml, id: created.id })
      });
      const wrapData = await wrapRes.json();
      if (wrapData.wrappedHtml) {
        created.bodyHtml = wrapData.wrappedHtml;
      }
    }

    closeCreateModal();
    await loadEmails();
    viewEmailDetails(created.id);
  } catch (err) {
    alert('Error creating email: ' + err.message);
  }
}

async function viewEmailDetails(id) {
  try {
    const res = await fetch(`/api/emails/${id}`);
    const email = await res.json();

    const origin = window.location.origin;
    const pixelUrl = `${origin}/media/v1/${email.id}.png`;
    const pixelTag = `<img src="${pixelUrl}" width="1" height="1" style="display:none !important;" />`;

    const modalContent = document.getElementById('details-modal-content');
    
    modalContent.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1.2rem;">
        
        <!-- Summary Box -->
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); padding: 1rem; border-radius: var(--radius-md);">
          <h4 style="font-size: 1.1rem; margin-bottom: 0.5rem;">${escapeHtml(email.subject)}</h4>
          <div style="display: flex; gap: 1.5rem; font-size: 0.85rem; color: var(--text-muted); flex-wrap: wrap;">
            <span><strong>To:</strong> ${escapeHtml(email.recipient)}</span>
            <span><strong>Created:</strong> ${formatDate(email.createdAt)}</span>
            <span><strong>Total Opens:</strong> ${email.openCount}</span>
            <span><strong>Link Clicks:</strong> ${email.clickCount || 0}</span>
          </div>
        </div>

        <!-- Gmail Direct Copy Box -->
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); padding: 16px; border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 10px;">
          <strong style="color: var(--success); font-size: 1rem;">Send via Gmail Compose (1-Click Copy)</strong>
          <p style="font-size: 0.85rem; color: var(--text-muted);">
            Click the button below, then open <strong>Gmail Compose</strong> and press <kbd style="background:#334155; color:#fff; padding:2px 6px; border-radius:4px;">Ctrl + V</kbd> to paste your message with the hidden tracking pixel!
          </p>
          <div>
            <button id="gmail-copy-btn" class="btn btn-primary" style="padding: 10px 20px; font-weight: 600; font-size: 0.95rem;">
              Copy for Gmail (Direct Paste)
            </button>
          </div>
        </div>

        <!-- Quick Test Actions -->
        <div style="display: flex; gap: 10px; flex-wrap: wrap; background: rgba(99, 102, 241, 0.08); padding: 12px; border-radius: var(--radius-md); border: 1px solid rgba(99, 102, 241, 0.2);">
          <button class="btn btn-secondary btn-sm" onclick="simulateOpen('${email.id}')">Test Open Pixel Now</button>
          <button class="btn btn-secondary btn-sm" onclick="sendTestSmtp('${email.id}')">Send via SMTP Sandbox</button>
          <a href="${pixelUrl}" target="_blank" class="btn btn-secondary btn-sm">Open Pixel Direct URL</a>
        </div>

        <!-- Raw Tracking Pixel Image Tag -->
        <div>
          <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 6px;">
            Raw Tracking Pixel Tag:
          </label>
          <div class="code-box">${escapeHtml(pixelTag)}</div>
          <button class="btn btn-sm btn-secondary" style="margin-top: 6px;" onclick="copyToClipboard('${escapeHtml(pixelTag)}')">Copy Raw Tag</button>
        </div>

        <!-- Event Audit Timeline -->
        <div>
          <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 8px;">Activity Audit Timeline</h4>
          ${renderAuditTimeline(email)}
        </div>
      </div>
    `;

    // Attach event listener safely to avoid inline HTML attribute string breaking
    const copyBtn = document.getElementById('gmail-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        copyForGmail(email.bodyHtml);
      });
    }

    document.getElementById('details-modal').classList.add('active');
  } catch (err) {
    alert('Failed to load email details');
  }
}

async function copyForGmail(htmlContent) {
  try {
    const blobHtml = new Blob([htmlContent], { type: 'text/html' });
    const blobText = new Blob([htmlContent.replace(/<[^>]*>/g, '')], { type: 'text/plain' });
    const item = new ClipboardItem({
      'text/html': blobHtml,
      'text/plain': blobText
    });
    await navigator.clipboard.write([item]);
    alert('✅ Copied to Clipboard!\n\n1. Open Gmail (mail.google.com)\n2. Click "Compose"\n3. Click in the message body & press Ctrl+V (or Cmd+V)\n\nYour message with the hidden tracking pixel is now in Gmail ready to send!');
  } catch (err) {
    copyHtmlFallback(htmlContent);
  }
}

function copyHtmlFallback(htmlContent) {
  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  container.style.position = 'fixed';
  container.style.pointerEvents = 'none';
  container.style.opacity = '0';
  document.body.appendChild(container);

  const range = document.createRange();
  range.selectNodeContents(container);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  document.execCommand('copy');
  document.body.removeChild(container);
  alert('✅ Copied to Clipboard!\n\nOpen Gmail Compose and press Ctrl+V to paste!');
}

function renderAuditTimeline(email) {
  const events = [];

  if (email.opensHistory) {
    email.opensHistory.forEach(o => {
      events.push({
        type: 'open',
        timestamp: o.timestamp,
        ip: o.ip,
        userAgent: o.userAgent
      });
    });
  }

  if (email.clicksHistory) {
    email.clicksHistory.forEach(c => {
      events.push({
        type: 'click',
        timestamp: c.timestamp,
        ip: c.ip,
        userAgent: c.userAgent,
        targetUrl: c.targetUrl
      });
    });
  }

  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (events.length === 0) {
    return `<p style="font-size: 0.85rem; color: var(--text-muted);">No activity recorded yet. When recipient opens email, events appear here in real-time!</p>`;
  }

  return `
    <div class="timeline">
      ${events.map(ev => {
        if (ev.type === 'open') {
          return `
            <div class="timeline-item">
              <span class="timeline-icon">👁️</span>
              <div class="timeline-details">
                <strong>Email Opened</strong>
                <span class="timeline-time">${formatDate(ev.timestamp)}</span>
                <span style="color: var(--text-muted); font-size: 0.75rem;">IP: ${ev.ip} | Client: ${ev.userAgent}</span>
              </div>
            </div>
          `;
        } else {
          return `
            <div class="timeline-item click-event">
              <span class="timeline-icon">🔗</span>
              <div class="timeline-details">
                <strong>Link Clicked: <a href="${ev.targetUrl}" target="_blank" style="color: var(--accent-blue);">${ev.targetUrl}</a></strong>
                <span class="timeline-time">${formatDate(ev.timestamp)}</span>
                <span style="color: var(--text-muted); font-size: 0.75rem;">IP: ${ev.ip} | Client: ${ev.userAgent}</span>
              </div>
            </div>
          `;
        }
      }).join('')}
    </div>
  `;
}

function closeDetailsModal() {
  document.getElementById('details-modal').classList.remove('active');
}

async function simulateOpen(id) {
  try {
    const res = await fetch(`/api/emails/simulate-open/${id}`, { method: 'POST' });
    await loadEmails();
    if (document.getElementById('details-modal').classList.contains('active')) {
      viewEmailDetails(id);
    }
  } catch (err) {
    alert('Failed to simulate open');
  }
}

async function sendTestSmtp(id) {
  try {
    const emailRes = await fetch(`/api/emails/${id}`);
    const email = await emailRes.json();

    const sendRes = await fetch('/api/emails/send-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email.recipient,
        subject: email.subject,
        html: email.bodyHtml
      })
    });
    const result = await sendRes.json();

    if (result.success && result.previewUrl) {
      alert(`Test Email sent successfully!\n\nOpening Ethereal Sandbox preview...`);
      window.open(result.previewUrl, '_blank');
    } else {
      alert('Error sending test email: ' + (result.details || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to send test email: ' + err.message);
  }
}

async function deleteEmail(id) {
  if (!confirm('Are you sure you want to delete this tracked email?')) return;

  try {
    await fetch(`/api/emails/${id}`, { method: 'DELETE' });
    await loadEmails();
    if (document.getElementById('details-modal').classList.contains('active')) {
      closeDetailsModal();
    }
  } catch (err) {
    alert('Failed to delete email');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied raw tag to clipboard!');
  }).catch(() => {
    alert('Failed to copy');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

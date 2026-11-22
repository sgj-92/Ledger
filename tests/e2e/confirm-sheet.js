// Ledger asks before something consequential in its own sheet (2026-11-22), not the
// browser's confirm(). For a page under test: every such question is answered yes, as the
// old dialog handlers did, and its text recorded in `seen` ("title\n\ndetail").
// Call before the page first navigates.
module.exports = async function acceptConfirms(p, seen){
  await p.exposeFunction('__cfSeen', t => { if (seen) seen.push(t); });
  await p.addInitScript(() => {
    new MutationObserver(() => {
      const y = document.getElementById('cfYes');
      if (!y || y.dataset.auto) return;
      y.dataset.auto = '1';
      const t = document.getElementById('cfTitle'), d = document.getElementById('cfDetail');
      window.__cfSeen((t ? t.textContent : '') + (d && !d.hidden && d.textContent ? '\n\n' + d.textContent : ''));
      setTimeout(() => {
        // it must be the thing on top, where a thumb would tap: a sheet hidden under another
        // layer is a page error, so the suite's "no page errors" check catches it
        const r = y.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === y || y.contains(hit))) setTimeout(() => { throw new Error('confirm sheet is covered by ' + (hit ? hit.className || hit.tagName : 'nothing')); });
        y.click();
      }, 260);
    }).observe(document, { childList: true, subtree: true });
  });
};

// ASRYO SHADOWBOUND: accessible image enlargement; no tracking or checkout.
const dialog = document.getElementById('imageViewer');
const viewer = document.getElementById('viewerImage');
const heading = document.getElementById('viewerTitle');
const closeButton = document.getElementById('closeViewer');
if (dialog && viewer && heading && closeButton) {
  document.querySelectorAll('.gallery-shot[data-full]').forEach(button => {
    button.addEventListener('click', () => {
      viewer.src = button.dataset.full;
      viewer.alt = button.querySelector('img')?.alt || 'ASRYO Shadowbound concept detail';
      heading.textContent = button.dataset.title || 'SHADOWBOUND / DESIGN VIEW';
      if (!dialog.open) dialog.showModal();
    });
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => viewer.removeAttribute('src'));
}

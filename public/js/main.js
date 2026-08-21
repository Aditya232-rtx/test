// Client-Side Utilities for Gin & Juice Shop

document.addEventListener('DOMContentLoaded', () => {
  // Handle copy buttons for code snippets and exploit payloads
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const textToCopy = document.getElementById(targetId)?.innerText || btn.getAttribute('data-payload');
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = btn.innerText;
          btn.innerText = 'Copied!';
          setTimeout(() => {
            btn.innerText = originalText;
          }, 1500);
        });
      }
    });
  });

  // Client-side quick filter for vulnerabilities table
  const searchInput = document.getElementById('vuln-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.vuln-card').forEach(card => {
        const text = card.innerText.toLowerCase();
        if (text.includes(query)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });
  }
});

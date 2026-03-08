/* Profilleme raporu - chart ve interaktivite */

// Tablo siralama
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('table.sortable thead th').forEach(th => {
    th.addEventListener('click', () => {
      const table = th.closest('table');
      const tbody = table.querySelector('tbody');
      const idx = Array.from(th.parentNode.children).indexOf(th);
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const asc = th.dataset.sort !== 'asc';

      rows.sort((a, b) => {
        const aVal = a.children[idx]?.textContent.trim() || '';
        const bVal = b.children[idx]?.textContent.trim() || '';
        const aNum = parseFloat(aVal.replace(/,/g, ''));
        const bNum = parseFloat(bVal.replace(/,/g, ''));

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return asc ? aNum - bNum : bNum - aNum;
        }
        return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });

      th.parentNode.querySelectorAll('th').forEach(t => delete t.dataset.sort);
      th.dataset.sort = asc ? 'asc' : 'desc';
      rows.forEach(row => tbody.appendChild(row));
    });
  });

  // Arama/Filtreleme
  document.querySelectorAll('.search-box').forEach(input => {
    input.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const targetId = input.dataset.target;
      const container = document.getElementById(targetId);
      if (!container) return;

      container.querySelectorAll('details.schema-block, tr.filterable').forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(query) ? '' : 'none';
      });
    });
  });
});

// Quality grade dagilim chart'i
function renderQualityChart(canvasId, labels, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Tablo Sayisi',
        data: data,
        backgroundColor: ['#e2efda', '#d9e2f3', '#fff2cc', '#fce4d6', '#f4cccc'],
        borderWidth: 0,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { grid: { display: false } },
      },
    },
  });
}

// Schema bazli satir sayisi chart'i
function renderRowCountChart(canvasId, labels, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Satir Sayisi',
        data: data,
        backgroundColor: '#1f4e79',
        borderWidth: 0,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true },
        y: { grid: { display: false } },
      },
    },
  });
}

self.onmessage = function(event) {
  try {
    const { data, config } = event.data || {};
    if (!Array.isArray(data)) {
      self.postMessage({ status: 'error', error: 'No data array provided' });
      return;
    }

    const xAxis = config?.xAxis;
    const yAxis = config?.yAxis;
    const aggregation = config?.aggregation || 'sum';
    const sortKey = config?.sortKey || 'y';
    const sortDirection = config?.sortDirection || 'desc';

    // Basic grouping and aggregation
    const groups = Object.create(null);

    for (const row of data) {
      const x = row?.[xAxis] ?? 'Unknown';
      const y = Number(row?.[yAxis]) || 0;
      if (!groups[x]) groups[x] = { name: x, value: 0, count: 0 };
      groups[x].value += y;
      groups[x].count += 1;
    }

    let result = Object.values(groups).map(g => ({ name: String(g.name), value: aggregation === 'average' && g.count > 0 ? g.value / g.count : g.value, size: g.count }));

    // Sorting
    if (sortKey === 'y') {
      result.sort((a,b) => (sortDirection === 'asc' ? a.value - b.value : b.value - a.value));
    } else {
      result.sort((a,b) => (sortDirection === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
    }

    // Limit results to reasonable number
    result = result.slice(0, 1000);

    self.postMessage({ status: 'success', data: result });
  } catch (err) {
    self.postMessage({ status: 'error', error: String(err) });
  }
};
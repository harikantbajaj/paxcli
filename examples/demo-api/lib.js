// Report generation for the demo API.
// The implementations below are deliberately inefficient (quadratic scans);
// `paxcli demo` lets a mock agent try to fix them.

export function makeDataset(size = 15000) {
  // Deterministic LCG so every run and every machine sees identical data.
  let seed = 42;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const data = [];
  for (let i = 0; i < size; i++) data.push(next() % 1000000);
  return data;
}

export function buildReport(data) {
  // Quadratic unique count: for each element, scan everything before it.
  let uniqueCount = 0;
  for (let i = 0; i < data.length; i++) {
    let seen = false;
    for (let j = 0; j < i; j++) {
      if (data[j] === data[i]) {
        seen = true;
        break;
      }
    }
    if (!seen) uniqueCount++;
  }

  // Repeated full scans to find the top 10 values.
  const top10 = [];
  const used = new Array(data.length).fill(false);
  for (let k = 0; k < 10; k++) {
    let bestIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (used[i]) continue;
      if (bestIdx === -1 || data[i] > data[bestIdx]) bestIdx = i;
    }
    if (bestIdx === -1) break;
    used[bestIdx] = true;
    top10.push(data[bestIdx]);
  }

  let sum = 0;
  for (const v of data) sum += v;

  return { sum, uniqueCount, top10 };
}

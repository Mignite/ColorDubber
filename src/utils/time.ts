export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ds = Math.floor((sec % 1) * 100);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ds).padStart(2, "0")}`;
}

export function parseTimeInput(str: string): number | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(":");
  if (parts.length < 1 || parts.length > 3) return null;

  const nums: number[] = [];
  for (const p of parts) {
    const trimmedP = p.trim();
    if (trimmedP === "") return null;
    const n = Number(trimmedP);
    if (isNaN(n) || n < 0) return null;
    nums.push(n);
  }

  let total = 0;
  if (nums.length === 1) {
    total = nums[0];
  } else if (nums.length === 2) {
    total = nums[0] * 60 + nums[1];
  } else {
    total = nums[0] * 3600 + nums[1] * 60 + nums[2];
  }
  return total;
}
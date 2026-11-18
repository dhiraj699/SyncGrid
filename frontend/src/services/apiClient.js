import { API_BASE } from '../config.js';

let authToken = null;
let unauthorizedHandler = () => {};

export const setAuthToken = (token) => { authToken = token; };
export const onUnauthorized = (handler) => { unauthorizedHandler = handler; };

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (response.status === 401 && authToken) unauthorizedHandler();
    throw new ApiError(response.status, payload?.error?.code ?? 'REQUEST_FAILED', payload?.error?.message ?? response.statusText);
  }
  return response.json();
}

export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  getDirectory: () => request('/api/auth/directory'),
  getSheet: (sheetId) => request(`/api/sheets/${sheetId}`),
  getBaseline: (sheetId) => request(`/api/sheets/${sheetId}/history/baseline`),
  getEvents: (sheetId, afterSeq, limit = 5000) => request(`/api/sheets/${sheetId}/history/events?afterSeq=${afterSeq}&limit=${limit}`),
  patchColumn: (sheetId, columnKey, patch) => request(`/api/sheets/${sheetId}/columns/${columnKey}`, { method: 'PATCH', body: patch }),
  exportCsv: async (sheetId) => {
    const response = await fetch(`${API_BASE}/api/sheets/${sheetId}/export`, {
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    });
    if (!response.ok) throw new Error('Export failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sheetId}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

const TOKEN_KEY = 'phdsite.adminToken';

export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || null;
  }
}

function handleFailure(status, data, path) {
  if (status === 401 && path !== '/api/auth/login') {
    session.clear();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  return new ApiError(status, data?.error || `The server answered with status ${status}`, data?.fields);
}

export async function request(method, path, body) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Is it running?");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw handleFailure(res.status, data, path);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};

/** Uploads a file as the raw request body, reporting progress (0..1). */
export function upload(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', path);
    if (session.token) xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(handleFailure(xhr.status, data, path));
    };
    xhr.onerror = () => reject(new ApiError(0, "Couldn't reach the server during the upload."));
    xhr.send(file);
  });
}

/**
  @param {string} url
  @param {(progress: number) => void} progress_callback
  */
export async function loadArrayBuffer(url, progress_callback) {
	const req = new XMLHttpRequest();
	req.responseType = "arraybuffer";
	req.addEventListener("progress", (ev) => {
		progress_callback(ev.loaded / ev.total);
	});

	const promise = new Promise((resolve, reject) => {
		req.addEventListener("load", (_) => {
			progress_callback(1);
			resolve(req.response);
		})

		req.addEventListener("error", (_) => {
			reject(new Error(`failed to load ${url}: ${req.status} ${req.statusText}`));
		})

		req.addEventListener("abort", (_) => {
			reject(new Error(`failed to load ${url}: abort`));
		})
	});

	req.open("GET", url);
	req.send();

	return promise;
}



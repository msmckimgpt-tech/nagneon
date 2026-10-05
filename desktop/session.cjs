function createStudioSession(session, service) {
  // This partition is scoped to the selected profile. Persist Chromium's device
  // identity salt; never persist the process authentication header ourselves.
  const studioSession = session.fromPartition('persist:backseat-studio', { cache: false });
  studioSession.webRequest.onBeforeSendHeaders(
    { urls: [service.url + '/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      for (const name of Object.keys(headers))
        if (name.toLowerCase() === 'authorization') delete headers[name];
      headers.Authorization = 'Bearer ' + service.accessToken;
      callback({ requestHeaders: headers });
    },
  );
  return studioSession;
}
module.exports = { createStudioSession };

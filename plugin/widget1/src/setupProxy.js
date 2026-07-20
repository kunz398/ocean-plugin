const fs = require('fs');
const path = require('path');

const NIUE_OUTPUT_DIR = path.resolve(
  process.env.NIUE_ZARR_OUTPUT_DIR || '/mnt/DATA/NIU/Niue_docker/output'
);

function sendZarrFile(req, res) {
  const requestPath = req.originalUrl.split('?')[0];
  const relativePath = decodeURIComponent(
    requestPath
      .replace(/^\/widget1\/zarr\/?/, '')
      .replace(/^\/zarr\/?/, '')
  );
  const targetPath = path.resolve(NIUE_OUTPUT_DIR, relativePath);

  if (!targetPath.startsWith(`${NIUE_OUTPUT_DIR}${path.sep}`)) {
    res.status(403).send('Forbidden');
    return;
  }

  fs.stat(targetPath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.status(404).send('Not found');
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(targetPath, { dotfiles: 'allow' });
  });
}

module.exports = function setupProxy(app) {
  app.use('/widget1/zarr', sendZarrFile);
  app.use('/zarr', sendZarrFile);
};

import {
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';

import {
  extname,
  join,
} from 'node:path';

import {
  constants,
  brotliCompress,
  gzip,
} from 'node:zlib';

import {
  promisify,
} from 'node:util';

const gzipAsync =
  promisify(gzip);

const brotliAsync =
  promisify(brotliCompress);

const root =
  new URL(
    '../dist/',
    import.meta.url
  );

const compressible =
  new Set([
    '.css',
    '.html',
    '.js',
    '.json',
    '.svg',
    '.txt',
    '.webmanifest',
  ]);

async function filesIn(directory) {
  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true,
      }
    );

  const files = [];

  for (const entry of entries) {
    const location =
      join(
        directory,
        entry.name
      );

    if (entry.isDirectory()) {
      files.push(
        ...await filesIn(location)
      );
    } else if (
      entry.isFile() &&
      !location.endsWith('.gz') &&
      !location.endsWith('.br')
    ) {
      files.push(location);
    }
  }

  return files;
}

const files =
  await filesIn(root.pathname);

let processed = 0;

for (const file of files) {
  if (
    !compressible.has(
      extname(file)
        .toLowerCase()
    )
  ) {
    continue;
  }

  const information =
    await stat(file);

  if (information.size < 1024) {
    continue;
  }

  const input =
    await readFile(file);

  const [
    gzipOutput,
    brotliOutput,
  ] = await Promise.all([
    gzipAsync(
      input,
      {
        level: 9,
      }
    ),

    brotliAsync(
      input,
      {
        params: {
          [constants
            .BROTLI_PARAM_QUALITY]:
            8,
        },
      }
    ),
  ]);

  await Promise.all([
    writeFile(
      `${file}.gz`,
      gzipOutput
    ),

    writeFile(
      `${file}.br`,
      brotliOutput
    ),
  ]);

  processed += 1;
}

console.log(
  `Precompressed ${processed} production assets.`
);

const { promises: fs } = require('fs');
const path = require('path');
const remark = require('remark');
const html = require('remark-html');
const frontmatter = require('remark-frontmatter');
const extract = require('remark-extract-frontmatter');
const yaml = require('yaml').parse;
const toHTML = remark()
  .use(html)
  .use(frontmatter, ['yaml'])
  .use(extract, { yaml: yaml });

const writeFile = async (target, data) => {
  console.debug(`Writing ${target} ...`);
  return fs.writeFile(target, JSON.stringify(data), 'utf-8');
};

const parse = async (el) =>
  new Promise((resolve, reject) =>
    toHTML.process(el, (err, file) => {
      if (err !== undefined && err !== null) return reject(err);
      return resolve({
        ...file.data,
        html: file.contents,
      });
    }),
  );

const main = async () => {
  const dataFolder = path.join(process.cwd(), 'data-js', 'photos');
  console.log(dataFolder);
  await fs.mkdir(dataFolder, {
    recursive: true,
  });

  return Promise.all([
    // Albums
    fs
      .readdir(path.join(process.cwd(), 'data', 'albums'))
      .then(async (files) => {
        const albums = await Promise.all(
          files
            .filter((s) => s.endsWith('.md'))
            .map(async (album) => ({
              slug: album.replace(/\.md$/, ''),
              doc: await parse(
                await fs.readFile(
                  path.join(process.cwd(), 'data', 'albums', album),
                  'utf-8',
                ),
              ),
            })),
        );

        albums.sort(({ doc: { createdAt: a } }, { doc: { createdAt: b } }) =>
          b.localeCompare(a),
        );

        await writeFile(
          path.join(process.cwd(), 'data-js', `albums.json`),
          albums.reduce((albums, album) => {
            const { slug, doc } = album;
            return {
              ...albums,
              [slug]: doc,
            };
          }, {}),
        );
      }),
    // Photos
    fs
      .readdir(path.join(process.cwd(), 'data', 'photos'))
      .then(async (files) => {
        const photos = files.filter((s) => s.endsWith('.md'));
        await writeFile(path.join(process.cwd(), 'data-js', `stats.json`), {
          photos: photos.length,
        });
        const photoDocs = await Promise.all(
          photos.map(async (f) => {
            const p = path.parse(f);
            const source = path.join(process.cwd(), 'data', 'photos', f);
            const target = path.join(
              process.cwd(),
              'data-js',
              'photos',
              `${p.name}.json`,
            );
            console.debug(`Loading ${source}...`);
            const doc = await parse(await fs.readFile(source, 'utf-8'));

            const sourceModified = (await fs.stat(source)).mtime;
            let targetModified = -1;
            try {
              targetModified = (await fs.stat(target)).mtime;
            } catch {}
            if (targetModified < sourceModified) {
              console.debug(`Writing ${target} ...`);
              await writeFile(target, doc);
            }
            return { slug: path.parse(f).name, doc };
          }),
        );
        // Write paginated, sorted photos pages
        photoDocs.sort(({ doc: { takenAt: a } }, { doc: { takenAt: b } }) =>
          b.localeCompare(a),
        );
        const photoPages = photoDocs.reduce(
          (chunks, { slug }) => {
            if ((chunks[chunks.length - 1].length ?? 0) >= 50) {
              chunks.push([]);
            }
            chunks[chunks.length - 1].push(slug);
            return chunks;
          },
          [[]],
        );
        await Promise.all(
          photoPages.map((page, k) =>
            writeFile(
              path.join(process.cwd(), 'data-js', `photos-takenAt-${k}.json`),
              page,
            ),
          ),
        );
      }),
  ]);
};

main();
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const archiver = require('archiver');

const exec = promisify(require('child_process').exec);

async function main() {
  console.log('Iniciando proceso...');

  try {
    console.log('Se removerá la carpeta nodejs si existe');
    await removeDirectoryIfExists('nodejs');

    console.log('Se creará la carpeta nodejs si no existe');
    await createDirectoryIfNotExists('nodejs');

    console.log(
      'Se copiará package.json y package-lock.json a la ruta /nodejs',
    );
    await copyFile('package.json', 'nodejs/package.json');
    await copyFile('package-lock.json', 'nodejs/package-lock.json');

    console.log('Nos trasladamos a la ruta /nodejs');
    process.chdir('nodejs');

    console.log('Descargamos los módulos de producción');
    await exec('npm install --only=prod');
    
    // console.log('Descargamos los módulos de css-inline');
    // await exec(
    //   'npm install @css-inline/css-inline @css-inline/css-inline-linux-arm64-gnu --force',
    // );

    console.log(
      'Eliminamos package.json y package-lock.json que copiamos previamente',
    );
    await removeFile('package.json');
    await removeFile('package-lock.json');

    console.log('Volvemos a la ruta inicial ../');
    process.chdir('../');

    console.log('Eliminaremos layer.zip si existe');
    await removeFile('layer.zip');

    console.log('Comprimiendo layer.zip...');
    await compressDirectory();

    // console.log('Eliminamos la carpeta nodejs');
    // process.chdir('..');
    // await removeDirectory('nodejs');

    console.log('Proceso completado.');
  } catch (error) {
    console.error('Error durante el proceso:', error);
  }
}

async function removeFile(filename) {
  try {
    await fs.promises.unlink(filename);
    console.log(`${filename} eliminado.`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Error al eliminar ${filename}: ${error.message}`);
    }
  }
}

async function removeDirectoryIfExists(dirPath) {
  try {
    const stats = await fs.promises.stat(dirPath);
    if (stats.isDirectory()) {
      await removeDirectory(dirPath);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(
        `Error al verificar si existe el directorio ${dirPath}: ${error.message}`,
      );
    }
  }
}

async function removeDirectory(dirPath) {
  try {
    await fs.promises.rmdir(dirPath, { recursive: true });
    console.log(`${dirPath} eliminado.`);
  } catch (error) {
    console.error(`Error al eliminar ${dirPath}: ${error.message}`);
  }
}

async function createDirectoryIfNotExists(dirPath) {
  try {
    await fs.promises.access(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        console.log(`${dirPath} creado.`);
      } catch (error) {
        console.error(
          `Error al crear el directorio ${dirPath}: ${error.message}`,
        );
      }
    } else {
      console.error(
        `Error al acceder al directorio ${dirPath}: ${error.message}`,
      );
    }
  }
}

async function copyFile(source, target) {
  try {
    await fs.promises.copyFile(source, target);
    console.log(`${source} copiado a ${target}.`);
  } catch (error) {
    console.error(`Error al copiar ${source} a ${target}: ${error.message}`);
  }
}

async function compressDirectory() {
  const output = fs.createWriteStream('layer.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log('\nArchivo zip creado correctamente.');
      resolve();
    });

    archive.on('error', (err) => {
      console.error(`Error al comprimir directorio: ${err.message}`);
      reject(err);
    });

    archive.pipe(output);
    archive.directory('nodejs/', 'nodejs');
    archive.finalize();
  });
}

main().catch((error) => console.error(error));

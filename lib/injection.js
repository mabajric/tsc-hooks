const fs = require('fs');
const JSON5 = require('json5');
const path = require('path');
const { exec } = require('child_process');

const getTsConfigPath = dirPath => path.resolve(dirPath, 'tsconfig.json');

const getJsonContents = jsonPath => {
	const contentsString = fs.readFileSync(jsonPath);
	return JSON5.parse(contentsString);
};

function findFileInParents(startDir, filename) {
	let currentDir = startDir;

	while (currentDir !== path.parse(currentDir).root) {
		const potentialPath = path.resolve(currentDir, filename);

		if (fs.existsSync(potentialPath)) {
			return potentialPath;
		}

		currentDir = path.dirname(currentDir);
	}

	throw new Error(`File ${filename} not found in any parent directories.`);
}

const requireHook = require('./utils/requireHook');
const installDependencies = require('./utils/installDependencies');
const watchDispatcher = require('./utils/watchDispatcher');

const tsconfigDir = process.cwd();
const tsconfigPath = getTsConfigPath(tsconfigDir);

if (fs.existsSync(tsconfigPath)) {
	const tsconfig = getJsonContents(tsconfigPath);
	const hookModules = [], dependencies = [];

	console.log(tsconfigPath);
	for (const hook of tsconfig.hooks || []) {
		// Get Hook by URL, by Official ID, or by Path
		const hookModule = requireHook(hook, tsconfigDir);

		// Add dependencies
		dependencies.push(...hookModule.dependencies);

		// Add hookModule
		hookModules.push(hookModule);
	}

	if (tsconfig.references && tsconfig.references.length) {
		const projects = tsconfig.references
			.map(reference => {
				if (reference.path.endsWith('*')) {
					const dirPath = reference.path.replace(/\*+/g, '');
					const directories = fs.readdirSync(dirPath).filter(
						file => fs.statSync(
							path.resolve(dirPath, file),
						).isDirectory(),
					);
					return directories.map(
						directoryName => path.resolve(dirPath, directoryName),
					);
				} else {
					return path.dirname(
						path.resolve(path),
					);
				}
			})
			.flat();

		const projectsWithHooks = projects
			.map(projectPath => {
				const projectConfig = getJsonContents(getTsConfigPath(projectPath));
				if (projectConfig.hooks && projectConfig.hooks.length) {
					return projectPath;
				}
				return null;
			})
			.filter(projectPath => projectPath);

		projectsWithHooks.forEach(projectPath => {
			const pathToInjection = findFileInParents('.', 'node_modules/tsc-hooks/lib/injection.js');
			exec('node ' + pathToInjection, {
				cwd: projectPath
			});
		});
	}

	// Install dependencies
	installDependencies(dependencies);

	// Call each hook
	for (const hookModule of hookModules || []) {
		// Create TSC Hook API
		const ignoredConfigOptions = [ 'save', 'ignore', 'path', 'directory' ];
		const watchedFiles = [];
		const api = {
			tsconfig: {
				...tsconfig,
				save() {
					const tsconfigCopy = JSON.parse(JSON.stringify(api.tsconfig));
					for (const ignoredConfigOption of ignoredConfigOptions) {
						eval(`delete tsconfigCopy.${ignoredConfigOption}`);
					}
					fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfigCopy, null, 2));
				},
				ignore(configOption) {
					ignoredConfigOptions.push(configOption);
					api.tsconfig.save();
				},
				path: tsconfigPath,
				directory: tsconfigDir
			},
			watch(...files) {
				watchedFiles.push.apply(watchedFiles, files);
			}
		};

		hookModule.onInitCompilation?.(api);
		watchDispatcher.add(watchedFiles);

		if (hookModule.onWatchCompilation) {
			watchDispatcher.on('all', (event, path) => hookModule.onWatchCompilation(event, path, api));
		}

		if (hookModule.onPostCompilation) {
			process.on('exit', () => hookModule.onPostCompilation(api));
		}
	}

	// Hooks may mutate the config, so write the original config back
	process.on('exit', () => fs.writeFileSync(tsconfigPath, tsconfigStr));
}

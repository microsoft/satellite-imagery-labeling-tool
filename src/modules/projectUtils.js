import { appSettings } from '../settings/project_admin_settings.js'

export class ProjectUtils {
    static async readProjectFile(fileBlob, readResults) {
        const project = {
            aoi: null,
            bbox: null,
            tasks: [],
            results: [],
            stats: {
                resultsNoTasks: 0,
                tasksNoResults: 0,
                largestLabeledTask: 0,
                primary: {},
                secondary: {}
            },
            colors: {
                primary: [],
                secondary: []
            }
        };
        
        //Quick lookup index for task area name to their array index in the cells.
        const taskIdxMap = {};

        const settingsFileName = 'project_builder_settings.json';

        const zip = await JSZip.loadAsync(fileBlob);

        let settings = zip.file(settingsFileName);
        let rootFolder = '';

        //Zip possibly has nested folder.
        if (settings === null) {
            Object.keys(zip.files).forEach(f => {
                if (f.indexOf(settingsFileName) > 0) {
                    rootFolder = f.substring(0, f.lastIndexOf('/'));
                    zip = zip.folder(rootFolder);
                    settings = zip.file(settingsFileName);
                }
            });
        }

        if (settings === null) {
            alert('Unable to load project.');
            return;
        }

        const config = JSON.parse(await settings.async('string'));

        //Load the area of interest into the drawing manager.
        project.aoi = config.features[0];
        project.bbox = (project.aoi.bbox) ? project.aoi.bbox : atlas.data.BoundingBox.fromData(project.aoi);

        //Load the tasks grid cells.
        let taskFolderPath = rootFolder + 'tasks/';
        const taskFolder = zip.folder(taskFolderPath);
        if (taskFolder) {
            const taskFiles = Object.keys(taskFolder.files);

            for (let i = 0; i < taskFiles.length; i++) {
                const t = taskFiles[i];
                if (t.indexOf(taskFolderPath) > -1 && !t.endsWith('/')) {
                    const task = JSON.parse(await taskFolder.file(t.replace(taskFolderPath, '')).async('string'));
                    taskIdxMap[task.features[0].properties.name] = project.tasks.length;
                    project.tasks.push(task.features[0]);
                }
            }
        }

        if(readResults) {
            //Extract results and calculate stats.
            let resultsFolderPath = rootFolder + 'results/';

            const resultsFolder = zip.folder(resultsFolderPath);
            if (resultsFolder) {    
                const taskFiles = Object.keys(resultsFolder.files);
    
                for (let i = 0; i < taskFiles.length; i++) {
                    const t = taskFiles[i];
                    if (t.indexOf(resultsFolderPath) > -1 && !t.endsWith('/')) {
                        const taskResult = JSON.parse(await resultsFolder.file(t.replace(resultsFolderPath, '')).async('string'));

                        if(taskResult.features.length > 0){
                            const idx = taskIdxMap[taskResult.features[0].properties.task_name];
                            if(typeof idx === 'number') {
                                const taskProps = project.tasks[idx].properties;
                                const stats = {
                                    numEntities: taskResult.features.length,
                                    primary: {},
                                    secondary: {}
                                };

                                if(project.stats.largestLabeledTask < stats.numEntities) {
                                    project.stats.largestLabeledTask = stats.numEntities;
                                }

                                taskProps.stats = stats;

                                for (let j = 0; j < taskResult.features.length; j++) {
                                    const f = taskResult.features[j];

                                    //Capture class stats.
                                    Object.keys(f.properties).forEach(k => {
                                        let name = f.properties[k];
                                        if(taskProps.primary_classes.names.indexOf(name) > -1){
                                            stats.primary[name] = stats.primary[name] + 1 || 1;
                                        } else if(taskProps.secondary_classes.names && taskProps.secondary_classes.names.indexOf(name) > -1){
                                            stats.secondary[name] = stats.secondary[name] + 1 || 1;
                                        }
                                    });
                                    project.results.push(f);
                                }
                            } else {
                                project.stats.resultsNoTasks += taskResult.features.length;
                            }
                        }
                    }
                }
            }

            project.tasks.forEach(c => {
                const stats = project.stats;

                if(!c.properties.stats || c.properties.stats.numEntities === 0) {
                    stats.tasksNoResults++;
                } else {
                    //Capture class stats.
                    c.properties.primary_classes.names.forEach(k => {
                        const v = c.properties.stats.primary[k];
                        stats.primary[k] = stats.primary[k] + v || v;
                    });

                    if(c.properties.secondary_classes.names) {
                        c.properties.secondary_classes.names.forEach(k => {
                            const v = c.properties.stats.secondary[k];
                            stats.secondary[k] = stats.secondary[k] + v || v;
                        });
                    }
                }
            });

            //Generate color expressions for classes.
            const primary = project.aoi.properties.primary_classes;
            const secondary = project.aoi.properties.secondary_classes;

            if(primary.colors.length > 0){
                //Create a match expression based on the primary classes property name.
                const colorExp = ['match', ['get', primary.property_name]];

                //Map the names to the colors.
                for (let i = 0; i < primary.names.length; i++) {
                    colorExp.push(primary.names[i], primary.colors[i]);
                }

                //Set default color to use when drawing.
                colorExp.push('yellow');

                project.colors.primary = colorExp;
            }

            if(secondary.names && secondary.names.length > 0) {
                //Create a match expression based on the primary classes property name.
                const colorExp = ['match', ['get', secondary.property_name]];

                //Create a color pallete for secondary values. 
                secondary.names.forEach((n, i) => {
                    if(i < appSettings.colorPalette.length) {
                        colorExp.push(n, appSettings.colorPalette[i]);
                    } else {
                        //Generate a random color.
                        colorExp.push(n, "#000000".replace(/0/g, function () { return (~~(Math.random() * 16)).toString(16); }));
                    }
                });

                //Set default color to use when drawing.
                colorExp.push('yellow');

                project.colors.secondary = colorExp;
            }
        }

        return project;
    }
}
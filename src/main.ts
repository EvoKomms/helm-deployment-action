import { execSync } from 'node:child_process';
import { GithubDto } from './github.value.dto';
import { HelmEnvVarDto } from './helm.env.var.dto';
import { HelmVariableDto } from './helm.variable.dto';
import fs from 'node:fs';

const dryRun = process.env.DRY_RUN === 'true';
const name = process.env.NAME;
const helmChartUrl = process.env.HELM_CHART_URL;
const helmChartVersion = process.env.HELM_CHART_VERSION;
const namespace = process.env.NAMESPACE;
const secrets: { [key: string]: string } = JSON.parse(process.env.GITHUB_SECRETS || '{}');
const variables: { [key: string]: string } = JSON.parse(process.env.GITHUB_VARIABLES || '{}');
const environmentVariables: { [key: string]: string } = JSON.parse(process.env.ENVIRONMENT_VARIABLES || '{}');
const prefix = process.env.GITHUB_SECRET_VARIABLE_PREFIX;
const environment = process.env.DEPLOYMENT_ENVIRONMENT;
const helmConfigMapVariableName = process.env.HELM_CONFIG_MAP_VARIABLE_NAME;
const helmSecretVariableName = process.env.HELM_SECRET_VARIABLE_NAME;
const helmEnvVarVariableName = process.env.HELM_ENV_VAR_VARIABLE_NAME;
const directHelmVariablePrefix = process.env.DIRECT_VARIABLE_PREFIX;
const tag = process.env.TAG;

let helmDeploymentCommand = `helm upgrade ${name} \\
  --kubeconfig .kubeConfig \\
  --kube-context ${environment} \\
  --install \\
  --create-namespace \\
  --namespace ${namespace} \\
  --set image.tag=${tag} \\
  `;

if (dryRun) {
  console.log('Executing Dry Run...');
}

const helmSecrets: Array<HelmVariableDto> = [];
const helmConfigMaps: Array<HelmVariableDto> = [];
const helmVariables: Array<HelmVariableDto> = [];
const helmEnvVars: Array<HelmEnvVarDto> = [];

if (!helmChartUrl) {
  throw new Error('Misconfigured action. Helm chart URL is missing.');
}

let useFile: boolean = false;

for (const secretName in secrets) {
  if (secretName.startsWith(`DEPLOYMENT_${prefix ? prefix.concat('_') : ''}${environment ? environment.concat('_') : ''}`)) {
    try {
      const varValue = JSON.parse(secrets[secretName]) as GithubDto;
      if (varValue.chart === name) {
        if (dryRun) {
          console.log(`Configuring secret with key: ${secretName}`);
        }
        helmSecrets.push({ key: varValue.key, useFile: varValue.useFile, value: varValue.value });
        useFile = useFile || varValue.useFile === true;
      }
    } catch (e: unknown) {
      console.error(`Misconfigured Github Secret: ${secretName}. Please correct and re-run.`);
      throw e;
    }
  }
}

for (const variableName in variables) {
  if (variableName.startsWith(`DEPLOYMENT_${prefix ? prefix.concat('_') : ''}${environment ? environment.concat('_') : ''}`)) {
    try {
      const varValue = JSON.parse(variables[variableName]) as GithubDto;
      if (varValue.chart === name) {
        if (dryRun) {
          console.log(`Configuring Variable with key: ${variableName}`);
        }
        if (variableName.startsWith(`DEPLOYMENT_${prefix ? prefix.concat('_') : ''}${environment ? environment.concat('_') : ''}${directHelmVariablePrefix}_`)) {
          helmVariables.push({ key: varValue.key, useFile: varValue.useFile, value: varValue.value });
        } else {
          helmConfigMaps.push({ key: varValue.key, useFile: varValue.useFile, value: varValue.value });
        }
        useFile = useFile || varValue.useFile === true;
      } else if (!varValue.chart && variableName.startsWith(`DEPLOYMENT_${prefix ? prefix.concat('_') : ''}${environment ? environment.concat('_') : ''}${directHelmVariablePrefix}_`)) {
        // Global Direct Helm Variable
        helmVariables.push({ key: varValue.key, useFile: varValue.useFile, value: varValue.value });
      }
    } catch (err: unknown) {
      console.error(`Misconfigured Github Variable: ${variableName}. Please correct and re-run.`, err);
      process.exit(123);
    }
  }
}

for (const environmentVariableName in environmentVariables) {
  helmEnvVars.push({ name: environmentVariableName, value: environmentVariables[environmentVariableName] });
}

// We need to escape all the Go sequences.
// Reference - https://stackoverflow.com/a/63636047/4546963

if (useFile) {
  let valuesFileContent: string = '';
  valuesFileContent += `${helmSecretVariableName}:\n`;
  for (const dto of helmSecrets) {
    valuesFileContent += `  - key: ${dto.key}\n`;
    valuesFileContent += `    value: ${getValue(dto)}\n`;
  }
  valuesFileContent += `${helmConfigMapVariableName}:\n`;
  for (const dto of helmConfigMaps) {
    valuesFileContent += `  - key: ${dto.key}\n`;
    valuesFileContent += `    value: ${getValue(dto)}\n`;
  }
  valuesFileContent += `${helmEnvVarVariableName}:\n`;
  for (const dto of helmEnvVars) {
    valuesFileContent += `  - name: ${dto.name}\n`;
    valuesFileContent += `    value: ${getValue(dto)}\n`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const helmValuesObject: any = {};
  for (const dto of helmVariables) {
    setDeepValue(helmValuesObject, dto.key, getValue(dto));
  }
  valuesFileContent += objectToYaml(helmValuesObject);

  fs.writeFileSync('.helmValues.yaml', valuesFileContent);

  helmDeploymentCommand = helmDeploymentCommand.concat(`-f .helmValues.yaml \\\n  ${helmChartUrl}`);
} else {
  for (let idx = 0; idx < helmSecrets.length; idx++) {
    const dto = helmSecrets[idx];
    helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${helmSecretVariableName}[${idx}].key='${dto.key}' \\\n  `);
    helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${helmSecretVariableName}[${idx}].value='${getValue(dto)}' \\\n  `);
  }

  for (let idx = 0; idx < helmConfigMaps.length; idx++) {
    const dto = helmConfigMaps[idx];
    helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${helmConfigMapVariableName}[${idx}].key='${dto.key}' \\\n  `);
    helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${helmConfigMapVariableName}[${idx}].value='${getValue(dto)}' \\\n  `);
  }

  for (let idx = 0; idx < helmEnvVars.length; idx++) {
    const dto = helmEnvVars[idx];
    helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${helmEnvVarVariableName}[${idx}].name='${dto.name}' \\\n  `);
    helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${helmEnvVarVariableName}[${idx}].value='${getValue(dto)}' \\\n  `);
  }

  for (const dto of helmVariables) helmDeploymentCommand = helmDeploymentCommand.concat(`--set ${dto.key}='${getValue(dto)}' \\\n  `);

  if (helmChartVersion) {
    helmDeploymentCommand = helmDeploymentCommand.concat(`--version ${helmChartVersion} \\\n  `);
  }

  helmDeploymentCommand = helmDeploymentCommand.concat(helmChartUrl);
}

let hadError = false;

if (dryRun) {
  console.log(`This is a Dry Run. Install command to be run: \n${helmDeploymentCommand}`);
} else {
  try {
    console.log(execSync(helmDeploymentCommand).toString('utf-8'));
  } catch (err: unknown) {
    if (err instanceof Error) {
      for (const dto of helmSecrets) {
        sanitize(err, dto.value);
      }
      for (const dto of helmConfigMaps) {
        sanitize(err, dto.value);
      }
      for (const dto of helmEnvVars) {
        sanitize(err, dto.value);
      }
    }
    console.error('Error while trying to install helmchart', err);
    hadError = true;
  } finally {
    if (fs.existsSync('.helmValues.yaml')) fs.rmSync('.helmValues.yaml');
    process.exit(hadError ? 223 : 0);
  }
}

function getValue(dto: HelmVariableDto | HelmEnvVarDto): string {
  if (useFile && 'useFile' in dto && dto.useFile) {
    return `|\n      ${dto.value}`;
  } else {
    return escapeGoSpecialChars(dto.value, useFile);
  }
}

function sanitize(err: Error, secret: string) {
  err.message = err.message.replace(escapeGoSpecialChars(secret), '<REDACTED>');
  err.stack = err.stack?.replace(escapeGoSpecialChars(secret), '<REDACTED>');
}

function escapeGoSpecialChars(value: string, useFile: boolean = false): string {
  const retVal = useFile ? value : value.split('\\').join(String.raw`\\`); // Do not escape backslashes if we are using file, as they are interpreted literally in that case.
  return retVal
    .split(',')
    .join(String.raw`\,`)
    .split('.')
    .join(String.raw`\.`)
    .split('{')
    .join(String.raw`\{`)
    .split('[')
    .join(String.raw`\[`)
    .split(']')
    .join(String.raw`\]`)
    .split('}')
    .join(String.raw`\}`);
}

type HelmValue = string | Array<HelmValue> | { [key: string]: HelmValue };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setDeepValue(obj: any, path: string, value: string) {
  const parts = path.replace(/\[(\d+)]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isNextIndex = /^\d+$/.test(nextPart);

    if (current[part] === undefined) {
      current[part] = isNextIndex ? [] : {};
    }

    current = current[part];
  }
  const lastPart = parts[parts.length - 1];

  if (/^\d+$/.test(lastPart) && Array.isArray(current)) {
    current[Number.parseInt(lastPart)] = value;
  } else {
    current[lastPart] = value;
  }
}

function objectToYaml(obj: HelmValue, indentLevel = 0): string {
  let yaml = '';
  const indent = '  '.repeat(indentLevel);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const itemObj = item as { [key: string]: HelmValue };
        const keys = Object.keys(itemObj);

        if (keys.length === 1) {
          const firstKey = keys[0];
          const firstVal = itemObj[firstKey];

          if (typeof firstVal === 'object' && firstVal !== null) {
            yaml += `${indent}- ${firstKey}:\n${objectToYaml(firstVal, indentLevel + 2)}`;
          } else {
            yaml += `${indent}- ${firstKey}: ${firstVal}\n`;
          }
        } else {
          yaml += `${indent}-\n${objectToYaml(itemObj, indentLevel + 1)}`;
        }
      } else {
        yaml += `${indent}- ${item}\n`;
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    const objVal = obj as { [key: string]: HelmValue };
    for (const key in objVal) {
      if (Object.prototype.hasOwnProperty.call(objVal, key)) {
        const value = objVal[key];
        if (typeof value === 'object' && value !== null) {
          yaml += `${indent}${key}:\n${objectToYaml(value, indentLevel + 1)}`;
        } else {
          yaml += `${indent}${key}: ${value}\n`;
        }
      }
    }
  }
  return yaml;
}

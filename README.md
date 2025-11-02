# Helm Deployment Action

[![⌛️ Build](https://github.com/KoreKomms/helm-deployment-action/actions/workflows/pr-checks.yml/badge.svg?branch=main)](https://github.com/KoreKomms/helm-deployment-action/actions/workflows/pr-checks.yml)


Github Action to deploy Helm Charts. Supports deployment of Github Variables and Github Secrets to Kubernetes as ConfigMaps and Secrets respectively. This action also support custom environment variables.

## Helm Chart Format

The `values.yaml` needs to have variables for configuring secrets and configmaps. These variable names can be specified in the action inputs.

```yml
config: []
secrets: []
envVars: []
```

Both config and secrets must be array of objects with 2 fields:
* `key`
* `value`

Environment variables must be of array of objects with 2 fields:
* `name`
* `value`

The corresponding configmap.yaml

```yml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-configmap
data:
  {{- range .Values.config }}
  {{ .key | quote }}: {{ .value | quote }}
  {{- end }}
```

The corresponding secrets.yaml

```yml
apiVersion: v1
kind: Secret
metadata:
  name: {{ .Release.Name }}-secret
type: Opaque
data:
  {{- range .Values.secrets }}
  {{ .key | quote }}: {{ .value | b64enc | quote }}
  {{- end }}
```

A snippet of the corresponding deployment.yaml

```yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "auth-service.fullname" . }}
  labels:
    {{- include "auth-service.labels" . | nindent 4 }}
spec:
  .
  .
  .
  template:
    .
    .
    .
    spec:
      containers:
        - name: {{ .Chart.name }}
          env:
          {{- range .Values.envVars }}
          - name: {{ .name }}
            value: {{ .value | quote }}
          {{- end }}
```

## Github Variables & Secrets

### Limitations

The environment name must always be in uppercase, because Github uppercases the variable and secret names.

The Github Variables and Secrets that need to be deployed must be in a particular format.

* They must begin with `DEPLOYMENT_`
* They can have a prefix (after the `DEPLOYMENT_`) - This is helpful if you have other secrets/variables that already begin with `DEPLOYMENT_`. For example, if the prefix is `PROJECTX`, the Secret/Variable name will need to start with `DEPLOYMENT_PROJECTX_`.
* They can specify the deployment environment. You have the ability to use the same action for deploying to different environments. This part will be useful in that case. For example, for DEV environment specific Secrets/Variables, the name will then need to begin with `DEPLOYMENT_PROJECTX_DEV_`
* The rest of the name can be anything, based on your readability.
* The values will need to be in a very specific format too. They will need to be a Json object with 3 fields
  * `key` - The secret/Config key
  * `value` - The secret/Config value
  * `chart` - The name of the Helm chart (or deployment, if the chart name is different from the deployment name), for which the secret/variable is applicable

An example value can be something like this:

```json
{ "key": "db.username", "value": "postgres", "chart": "auth-service" }
```

## Complex Values

For complex values, you'd want to not use the helm set variable from the command line directly. Instead, you can use the `useFile` field to create a temporary values yaml file, and use that Helm can use to deploy the variable for the chart.

```json
{ "key": "db.config", "value": "{ \"host\": \"db.example.com\", \"port\": 5432, \"username\": \"postgres\", \"password\": \"mysecretpassword\" }", "useFile": true, "chart": "auth-service" }
```

## Example Action

The following example action will deploy the `auth-service` Helm chart.

```yml
name: "⌛️ Deploy Helm Chart"

on:
  workflow_dispatch:

jobs:
  helm-deploy:
    steps:
      - name: Deploy
        uses: KoreKomms/helm-deployment-action@v1
        with:
          helmChartUrl: oci://myregistry.example.com/mycompanyinc/auth-service
          helmChartVersion: 1.2.3
          registryUsername: myhelmregistryuser
          registryPassword: mySuperSecretPassword # Don't use this as your password, dahoy!
          # name: auth-service - This is not needed since this name is the same as the chart name in the helmChartUrl above.
          githubSecretVariablePrefix: PROJECTX
          deploymentEnvironment: DEV # Note that Github always uppercases the secret and variable names
          namespace: project-x
          helmConfigMapVariableName: config
          helmSecretVariableName: secrets
          helmEnvVarVariableName: envVars
          kubeConfig: ${{ secrets.KUBE_CONFIG }}
          secrets: ${{ secrets | toJson }}
          variables: ${{ vars | toJson }}
          environmentVariables: '{ "NODE_OPTIONS": "--max-old-space-size=8192", "JAVA_OPTS": "-Xms128m -Xmx256g", "SPRING_PROFILES_ACTIVE": "k8s,dev" }'
```

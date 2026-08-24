{{- define "visu-tee.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "visu-tee.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "visu-tee.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "visu-tee.labels" -}}
app.kubernetes.io/name: {{ include "visu-tee.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "visu-tee.selectorLabels" -}}
app.kubernetes.io/name: {{ include "visu-tee.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

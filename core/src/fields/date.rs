use std::{cmp::Ordering, collections::HashSet, sync::Arc};

use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, SecondsFormat, Timelike};
use serde::Deserialize;

use super::{
    compiled::scalar_type, CompiledField, FieldBehavior, FieldCompileError, FieldType,
    FieldValueError, Operation, RawField, ValidationError,
};
use crate::ScalarValue;

#[derive(Clone, Copy, Debug, Default)]
pub struct DateFieldType;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    #[default]
    Date,
    Time,
    Datetime,
}

impl Mode {
    fn domain(self) -> &'static str {
        match self {
            Self::Date => "date",
            Self::Time => "time",
            Self::Datetime => "datetime",
        }
    }

    fn format(self) -> &'static str {
        match self {
            Self::Date => "tg_validation_date_format_date",
            Self::Time => "tg_validation_date_format_time",
            Self::Datetime => "tg_validation_date_format_datetime",
        }
    }

    // The comparable number is a day, a clock tick, or an instant depending on
    // the mode. Named timezone conversion belongs to JS; core compares instants.
    fn parse(self, value: &str) -> Option<(String, i128)> {
        match self {
            Self::Date => {
                let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
                if !(1..=9999).contains(&date.year()) || date.to_string() != value {
                    return None;
                }
                Some((value.into(), date.num_days_from_ce() as i128))
            }
            Self::Time => {
                let time = NaiveTime::parse_from_str(value, "%H:%M:%S%.f")
                    .or_else(|_| NaiveTime::parse_from_str(value, "%H:%M"))
                    .ok()?;
                if value.as_bytes().get(2) != Some(&b':')
                    || value.len() < 5
                    || time.nanosecond() >= 1_000_000_000
                {
                    return None;
                }
                let canonical = time.format("%H:%M:%S%.f").to_string();
                if !valid_clock_shape(value) {
                    return None;
                }
                Some((
                    canonical,
                    time.num_seconds_from_midnight() as i128 * 1_000_000_000
                        + time.nanosecond() as i128,
                ))
            }
            Self::Datetime => {
                // Use one precise wire format across Rust, Temporal and HTML.
                if value.as_bytes().get(10) != Some(&b'T') || value.len() < 20 {
                    return None;
                }
                Self::Date.parse(value.get(..10)?)?;
                let rest = value.get(11..)?;
                let clock = rest
                    .strip_suffix('Z')
                    .unwrap_or_else(|| rest.split(['+', '-']).next().unwrap_or(rest));
                if clock.len() < 8 || !valid_clock_shape(clock) {
                    return None;
                }
                let date = DateTime::parse_from_rfc3339(value).ok()?;
                let utc = date.to_utc();
                if !(1..=9999).contains(&date.year())
                    || !(1..=9999).contains(&utc.year())
                    || date.nanosecond() >= 1_000_000_000
                    || value.ends_with("-00:00")
                {
                    return None;
                }
                Some((
                    utc.to_rfc3339_opts(SecondsFormat::AutoSi, true),
                    date.timestamp() as i128 * 1_000_000_000 + date.nanosecond() as i128,
                ))
            }
        }
    }
}

fn valid_clock_shape(value: &str) -> bool {
    let bytes = value.as_bytes();
    let digits = |slice: &[u8]| slice.iter().all(u8::is_ascii_digit);
    bytes.len() >= 5
        && bytes[2] == b':'
        && digits(&bytes[..2])
        && digits(&bytes[3..5])
        && (bytes.len() == 5
            || bytes.len() >= 8
                && bytes[5] == b':'
                && digits(&bytes[6..8])
                && (bytes.len() == 8
                    || (10..=12).contains(&bytes.len()) && bytes[8] == b'.' && digits(&bytes[9..])))
}

impl FieldType for DateFieldType {
    fn type_name(&self) -> &'static str {
        "date"
    }

    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        let mut descriptor = crate::catalog::scalar(
            "date",
            "tg_schema_date_time",
            "tg_schema_calendar_dates_clock_times_or_timezone_aware_instants_empty_values_are_null",
            "string",
            vec![crate::catalog::validator(
                "required",
                "tg_catalog_required",
                "tg_schema_a_date_time_value_is_required",
                false,
                false,
            )],
        );
        descriptor.settings = Some(crate::catalog::components(serde_json::json!([
            {"type":"text","key":"mode","view":{"label":"tg_catalog_accept","editorControl":"select","options":[{"value":"date","label":"tg_catalog_date_only"},{"value":"time","label":"tg_catalog_time_only"},{"value":"datetime","label":"tg_catalog_date_and_time"}]}},
            {"type":"text","key":"timeZone","view":{"label":"tg_catalog_timezone","description":"tg_schema_date_and_time_only_iana_name_or_fixed_offset_defaults_to_utc"}},
            {"type":"text","key":"disambiguation","view":{"label":"tg_catalog_repeated_daylight_saving_time","description":"tg_schema_date_and_time_only_defaults_to_reject","editorControl":"select","options":["reject","earlier","later"]}}
        ])));
        for kind in ["min", "max"] {
            descriptor.validators.push(crate::catalog::ValidatorDescriptor {
                kind: kind.into(), label: if kind == "min" { "tg_schema_minimum" } else { "tg_schema_maximum" }.into(),
                description: "tg_schema_inclusive_bound_in_the_configured_mode_s_value_format_datetime_bounds_compare_instants".into(),
                settings: crate::catalog::components(serde_json::json!([
                    {"type":"text","key":"value","view":{"label":"tg_catalog_limit","description":"tg_schema_date_yyyy_mm_dd_time_hh_mm_ss_date_and_time_rfc_3339_with_offset"},"validators":[{"kind":"required"}]}
                ])),
            });
        }
        descriptor
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        for property in raw.configuration.keys() {
            if !["mode", "timeZone", "disambiguation", "bindings"].contains(&property.as_str()) {
                return Err(FieldCompileError::UnsupportedConfiguration {
                    property: property.clone(),
                });
            }
        }
        let mode = raw
            .configuration
            .get("mode")
            .map(|value| serde_json::from_value::<Mode>(value.clone()))
            .transpose()
            .map_err(|_| FieldCompileError::InvalidConfiguration {
                message: "tg_schema_mode_must_be_date_time_or_datetime".into(),
            })?
            .unwrap_or_default();
        if !matches!(mode, Mode::Datetime)
            && (raw.configuration.contains_key("timeZone")
                || raw.configuration.contains_key("disambiguation"))
        {
            return Err(FieldCompileError::InvalidConfiguration { message: "tg_schema_timezone_and_disambiguation_require_datetime_mode_a_clock_time_has_no_date_for_dayligh".into() });
        }
        if let Some(zone) = raw.configuration.get("timeZone") {
            if zone
                .as_str()
                .is_none_or(|value| value.is_empty() || value.trim() != value)
            {
                return Err(FieldCompileError::InvalidConfiguration { message: "tg_schema_timezone_must_be_a_nonempty_timezone_identifier_js_resolves_its_availability".into() });
            }
        }
        if let Some(policy) = raw.configuration.get("disambiguation") {
            if !policy
                .as_str()
                .is_some_and(|value| ["reject", "earlier", "later"].contains(&value))
            {
                return Err(FieldCompileError::InvalidConfiguration {
                    message: "tg_schema_disambiguation_must_be_reject_earlier_or_later".into(),
                });
            }
        }
        let mut validators = vec![];
        let mut seen = HashSet::new();
        let mut min = None;
        let mut max = None;
        for validator in &raw.validators {
            let invalid = |message: &str| FieldCompileError::InvalidValidator {
                validator: validator.kind.clone(),
                message: message.into(),
            };
            if !seen.insert(&validator.kind) {
                return Err(invalid("tg_schema_validator_is_declared_more_than_once"));
            }
            match validator.kind.as_str() {
                "required" if validator.configuration.is_empty() => {
                    validators.push(DateValidator::Required)
                }
                "required" => return Err(invalid("tg_schema_required_accepts_no_properties")),
                "min" | "max" => {
                    if validator.configuration.len() != 1 {
                        return Err(invalid("tg_schema_expected_properties_value"));
                    }
                    let parsed = validator
                        .configuration
                        .get("value")
                        .and_then(|value| value.as_str())
                        .and_then(|value| mode.parse(value))
                        .ok_or_else(|| {
                            invalid(&crate::messages::diagnostic(
                                "tg_schema_value_must_be",
                                serde_json::json!({"format": {"messageKey": mode.format()}}),
                            ))
                        })?;
                    if validator.kind == "min" {
                        min = Some(parsed.1);
                    } else {
                        max = Some(parsed.1);
                    }
                    validators.push(DateValidator::Bound {
                        minimum: validator.kind == "min",
                        label: parsed.0,
                        limit: parsed.1,
                    });
                }
                _ => {
                    return Err(FieldCompileError::UnsupportedValidator {
                        validator: validator.kind.clone(),
                    })
                }
            }
        }
        if matches!((min, max), (Some(min), Some(max)) if min > max) {
            return Err(FieldCompileError::InvalidValidator {
                validator: "min".into(),
                message: "tg_schema_minimum_cannot_exceed_maximum".into(),
            });
        }
        CompiledField::new(raw, Arc::new(DateBehavior { mode, validators }))
    }
}

#[derive(Debug)]
enum DateValidator {
    Required,
    Bound {
        minimum: bool,
        label: String,
        limit: i128,
    },
}

#[derive(Debug)]
struct DateBehavior {
    mode: Mode,
    validators: Vec<DateValidator>,
}

impl FieldBehavior for DateBehavior {
    fn type_name(&self) -> &'static str {
        "date"
    }
    fn comparison_domain(&self) -> &'static str {
        self.mode.domain()
    }
    fn supports_operation(&self, _: Operation) -> bool {
        true
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        match value {
            ScalarValue::Null => Ok(ScalarValue::Null),
            ScalarValue::String(value) if value.is_empty() => Ok(ScalarValue::Null),
            ScalarValue::String(value) => Ok(ScalarValue::String(
                self.mode
                    .parse(value)
                    .map(|parsed| parsed.0)
                    .unwrap_or_else(|| value.clone()),
            )),
            _ => Err(FieldValueError::InvalidType {
                expected: "tg_schema_date_time_string_or_null".into(),
                received: scalar_type(value).into(),
            }),
        }
    }

    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        let parsed = match value {
            ScalarValue::String(value) => match self.mode.parse(value) {
                Some(parsed) => Some(parsed.1),
                None => {
                    return vec![
                        ValidationError::new("date", "tg_validation_date").with_params(
                            serde_json::json!({"format": {"messageKey": self.mode.format()}}),
                        ),
                    ]
                }
            },
            _ => None,
        };
        let mut errors = vec![];
        for validator in &self.validators {
            match validator {
                DateValidator::Required if parsed.is_none() => {
                    errors.push(ValidationError::new("required", "tg_validation_required"))
                }
                DateValidator::Bound {
                    minimum,
                    label,
                    limit,
                } if parsed.is_some_and(|value| {
                    if *minimum {
                        value < *limit
                    } else {
                        value > *limit
                    }
                }) =>
                {
                    errors.push(
                        ValidationError::new(
                            if *minimum { "min" } else { "max" },
                            if *minimum {
                                "tg_validation_date_min"
                            } else {
                                "tg_validation_date_max"
                            },
                        )
                        .with_params(
                            serde_json::json!({if *minimum { "min" } else { "max" }: label}),
                        ),
                    )
                }
                _ => {}
            }
        }
        errors
    }

    fn compare(
        &self,
        left: &ScalarValue,
        operation: Operation,
        right: &ScalarValue,
    ) -> Result<bool, FieldValueError> {
        let left = self.normalize_value(left)?;
        let right = self.normalize_value(right)?;
        let parse = |value: &ScalarValue| match value {
            ScalarValue::String(value) => self.mode.parse(value).map(|value| value.1),
            _ => None,
        };
        let (a, b) = (parse(&left), parse(&right));
        // Incomplete/invalid entries cannot trigger temporal rules. Null still
        // supports equality, while ordering requires two meaningful values.
        if matches!(&left, ScalarValue::String(_)) && a.is_none()
            || matches!(&right, ScalarValue::String(_)) && b.is_none()
        {
            return Ok(false);
        }
        Ok(match operation {
            Operation::Eq => a == b,
            Operation::Neq => a != b,
            operation => match (a, b) {
                (Some(a), Some(b)) => match operation {
                    Operation::Lt => a.cmp(&b) == Ordering::Less,
                    Operation::Gt => a.cmp(&b) == Ordering::Greater,
                    Operation::LEqt => a <= b,
                    Operation::GEqt => a >= b,
                    _ => unreachable!(),
                },
                _ => false,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn field(mode: &str, validators: serde_json::Value) -> CompiledField {
        DateFieldType
            .compile(
                &serde_json::from_value(
                    json!({"type":"date","key":"date","mode":mode,"validators":validators}),
                )
                .unwrap(),
            )
            .unwrap()
    }
    fn value(text: &str) -> ScalarValue {
        ScalarValue::String(text.into())
    }

    #[test]
    fn calendar_validation_checks_leap_years_and_strict_formats() {
        let date = field("date", json!([]));
        for valid in ["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"] {
            assert!(date.validate(&value(valid)).is_empty(), "{}", valid);
        }
        for invalid in [
            "2023-02-29",
            "1900-02-29",
            "2026-04-31",
            "2026-13-01",
            "2026-1-01",
            "0000-01-01",
            "2026-10-07T00:00:00Z",
            " 2026-10-07",
        ] {
            assert_eq!(
                date.validate(&value(invalid))[0].code,
                "date",
                "{}",
                invalid
            );
        }
        assert_eq!(date.normalize_value(&value("")).unwrap(), ScalarValue::Null);
        assert!(date.normalize_value(&ScalarValue::Number(123.0)).is_err());
    }

    #[test]
    fn times_normalize_and_reject_overflow_and_leap_seconds() {
        let time = field("time", json!([]));
        assert_eq!(
            time.normalize_value(&value("09:30")).unwrap(),
            value("09:30:00")
        );
        for valid in [
            "00:00:00",
            "23:59:59",
            "09:30:00.123",
            "09:30:00.1",
            "09:30:00.000",
        ] {
            assert!(time.validate(&value(valid)).is_empty(), "{}", valid);
        }
        for invalid in [
            "24:00",
            "12:60",
            "23:59:60",
            "9:30",
            "09:30Z",
            "09:30+02:00",
            "09:30:00.1234",
            "2026-10-07",
        ] {
            assert!(!time.validate(&value(invalid)).is_empty(), "{}", invalid);
        }
    }

    #[test]
    fn datetime_compares_instants_and_preserves_subsecond_precision() {
        let date = field("datetime", json!([]));
        assert_eq!(
            date.normalize_value(&value("2026-10-07T09:30:00+02:00"))
                .unwrap(),
            value("2026-10-07T07:30:00Z")
        );
        assert!(date
            .compare(
                &value("2026-10-07T09:30:00+02:00"),
                Operation::Eq,
                &value("2026-10-07T07:30:00Z")
            )
            .unwrap());
        assert!(date
            .compare(
                &value("2026-10-07T09:30:00+02:00"),
                Operation::Lt,
                &value("2026-10-07T08:00:00Z")
            )
            .unwrap());
        assert_eq!(
            date.normalize_value(&value("2026-10-07T00:00:00.123-05:30"))
                .unwrap(),
            value("2026-10-07T05:30:00.123Z")
        );
        for invalid in [
            "2026-10-07T09:30:00",
            "2026-10-07T09:30:00.1234Z",
            "2026-10-07T09:30:00-00:00",
            "2026-10-07T23:59:60Z",
            "2026-02-29T09:30:00Z",
        ] {
            assert!(!date.validate(&value(invalid)).is_empty(), "{}", invalid);
        }
        assert!(!date
            .compare(
                &ScalarValue::Null,
                Operation::Lt,
                &value("2026-10-07T00:00:00Z")
            )
            .unwrap());
        assert!(!date
            .compare(&value("invalid"), Operation::Neq, &ScalarValue::Null)
            .unwrap());
    }

    #[test]
    fn required_and_inclusive_bounds_use_the_selected_mode() {
        for (mode, min, max, outside) in [
            ("date", "2026-01-01", "2026-12-31", "2025-12-31"),
            ("time", "09:00", "17:00", "08:59"),
            (
                "datetime",
                "2026-10-07T09:00:00+02:00",
                "2026-10-07T08:00:00Z",
                "2026-10-07T06:59:00Z",
            ),
        ] {
            let date = field(
                mode,
                json!([{"kind":"required"},{"kind":"min","value":min},{"kind":"max","value":max}]),
            );
            assert_eq!(date.validate(&ScalarValue::Null)[0].code, "required");
            assert!(date.validate(&value(min)).is_empty());
            assert!(date.validate(&value(max)).is_empty());
            assert_eq!(date.validate(&value(outside))[0].code, "min");
        }
    }

    #[test]
    fn rejects_bad_config_and_validator_definitions() {
        for config in [
            json!({"mode":"invalid"}),
            json!({"mode":12}),
            json!({"timeZone":"UTC"}),
            json!({"mode":"datetime","timeZone":42}),
            json!({"mode":"datetime","disambiguation":"compatible"}),
            json!({"unknown":true}),
            json!({"validators":[{"kind":"min","value":"2026-02-29"}]}),
            json!({"validators":[{"kind":"required","value":true}]}),
            json!({"validators":[{"kind":"required"},{"kind":"required"}]}),
            json!({"validators":[{"kind":"min","value":"2026-10-08"},{"kind":"max","value":"2026-10-07"}]}),
            json!({"validators":[{"kind":"min_length","value":2}]}),
        ] {
            let mut raw = json!({"type":"date","key":"date"});
            raw.as_object_mut()
                .unwrap()
                .extend(config.as_object().unwrap().clone());
            assert!(
                DateFieldType
                    .compile(&serde_json::from_value(raw).unwrap())
                    .is_err(),
                "{}",
                config
            );
        }
    }

    #[test]
    fn rules_reject_cross_mode_and_text_references() {
        for right in [
            serde_json::json!({"type":"date","key":"other","mode":"time"}),
            serde_json::json!({"type":"text","key":"other"}),
        ] {
            let schema = serde_json::from_value(serde_json::json!({"schemaVersion":"sprout","form":[
                {"type":"date","key":"day"}, right,
                {"type":"boolean","key":"result","rules":[{"when":{"property":"day","operation":"Lt","value":{"ref":"other"}},"then":[{"kind":"set_value","value":true}]}]}
            ]})).unwrap();
            assert!(crate::compiler::SchemaCompiler::new()
                .compile(schema)
                .is_err());
        }
    }
}

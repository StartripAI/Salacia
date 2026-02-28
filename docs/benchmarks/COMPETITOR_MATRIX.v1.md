# Competitor Matrix v1

This matrix binds benchmark dimensions to the locked competitor set in
`docs/benchmarks/COMPETITOR_SET.v1.json`.

## Competitor Set

- Trellis (open-source, AGPL, capability parity only via clean-room)
- aider (open-source, Apache-2.0)
- cline (open-source, Apache-2.0)
- continue (open-source, Apache-2.0)
- opencode (open-source, MIT)
- claude-code (open-source)
- cursor (closed-source, black-box comparison)

## Dimension Mapping

| Dimension | Trellis | aider | cline | continue | opencode | claude-code | cursor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| prompt_quality | yes | yes | yes | yes | yes | yes | yes |
| contract_integrity | yes | partial | partial | yes | partial | partial | partial |
| convergence_robustness | yes | partial | yes | yes | partial | yes | yes |
| execution_governance | yes | yes | yes | yes | partial | yes | partial |
| ide_native_depth | partial | no | yes | partial | partial | no | yes |
| protocol_behavior | partial | no | partial | yes | yes | partial | partial |
| scale_stability | yes | yes | partial | yes | partial | yes | unknown |
| compliance_audit | yes | yes | yes | yes | yes | partial | unknown |
| anti_gaming | yes | partial | partial | partial | partial | partial | unknown |

`yes/partial/no/unknown` are capability-level comparability tags, not score outcomes.

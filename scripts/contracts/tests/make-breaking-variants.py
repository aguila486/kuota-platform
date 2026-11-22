"""Genera variantes del contrato empaquetado para probar breaking.sh (T024). Uso: make-breaking-variants.py BUNDLE DIR"""
import copy, sys
import yaml

base = yaml.safe_load(open(sys.argv[1]))
out = sys.argv[2]
schemas = lambda d: d['components']['schemas']

def variant(name, mutate):
    doc = copy.deepcopy(base)
    mutate(doc)
    with open(f'{out}/{name}.yaml', 'w') as fh:
        yaml.safe_dump(doc, fh, sort_keys=False, allow_unicode=True)

variant('unchanged', lambda d: None)
# Compatibles: propiedad opcional nueva en una respuesta y endpoint nuevo.
def compatible(d):
    schemas(d)['CompatibilityInfo']['properties']['region'] = {'type': 'string'}
    d['paths']['/v1/meta/ping'] = {'get': {'operationId': 'ping', 'summary': 'Ping.', 'tags': ['meta'], 'security': [],
                                           'responses': {'200': {'description': 'OK.'}}}}
variant('compatible', compatible)
variant('endpoint-removed', lambda d: d['paths'].pop('/v1/meta/compatibility'))
variant('property-type-changed', lambda d: schemas(d)['CompatibilityInfo']['properties']['api_version'].update(type='integer'))
def request_required(d):
    s = schemas(d)['DevProbeItemCreate']; s['required'] = s['required'] + ['sample_amount']
variant('request-property-required', request_required)
def response_required_removed(d):
    s = schemas(d)['CompatibilityInfo']; s['required'] = [r for r in s['required'] if r != 'server_time']
variant('response-required-removed', response_required_removed)
variant('response-became-nullable', lambda d: schemas(d)['CompatibilityInfo']['properties']['api_version'].update(type=['string', 'null']))
print('variantes generadas')

import { StringBuilder } from '@proficient/ds';

import { PYTHON_UNDEFINED_SENTINEL_CLASS } from '../../constants.js';
import type {
  PythonAliasDeclaration,
  PythonDeclaration,
  PythonEnumClassDeclaration,
  PythonGeneration,
  PythonPydanticClassDeclaration,
} from '../../generators/python/index.js';
import { python } from '../../platforms/python/index.js';
import { assertNever } from '../../util/assert.js';
import { multiply } from '../../util/multiply-str.js';
import { space } from '../../util/space.js';
import type { RenderedFile } from '../_types.js';
import type { PythonRenderer, PythonRendererConfig } from './_types.js';

class PythonRendererImpl implements PythonRenderer {
  public readonly type = 'python';

  public constructor(private readonly config: PythonRendererConfig) {}

  public async render(g: PythonGeneration): Promise<RenderedFile> {
    const b = new StringBuilder();

    b.append(`${this.generateImportStatements()}\n\n`);
    b.append(`${this.generateStaticDeclarations()}\n\n`);
    b.append(`# Model Definitions\n\n`);

    g.declarations.forEach(declaration => {
      b.append(`${this.renderDeclaration(declaration)}\n\n`);
    });

    const rootFile: RenderedFile = {
      content: b.toString(),
    };

    return rootFile;
  }

  private generateImportStatements() {
    const b = new StringBuilder();
    b.append(`from __future__ import annotations\n\n`);
    b.append(`import typing\n`);
    b.append(`import datetime\n`);
    b.append(`import enum\n`);
    b.append(`import pydantic\n`);
    b.append(`from pydantic_core import core_schema\n`);
    b.append(`from typing_extensions import Annotated`);
    if (this.config.customPydanticBase) {
      const { importPath, className } = this.config.customPydanticBase;
      b.append(`\nfrom ${importPath} import ${className}`);
    }
    return b.toString();
  }

  private generateStaticDeclarations() {
    const b = new StringBuilder();

    b.append(this.generateStaticDeclarationsForUndefinedSentinel());
    b.append(`\n\n`);
    b.append(this.generateStaticDeclarationsForTypesyncModel());

    return b.toString();
  }

  private generateStaticDeclarationsForUndefinedSentinel() {
    const { undefinedSentinelName } = this.config;
    const b = new StringBuilder();

    b.append(`${this.indent(0)}class ${PYTHON_UNDEFINED_SENTINEL_CLASS}:\n`);
    b.append(
      `${this.indent(1)}"""Do not use this class in your code. Use the \`${undefinedSentinelName}\` sentinel instead."""\n`
    );
    b.append(`${this.indent(1)}_instance = None\n\n`);

    b.append(`${this.indent(1)}def __init__(self):\n`);
    b.append(`${this.indent(2)}if ${PYTHON_UNDEFINED_SENTINEL_CLASS}._instance is not None:\n`);
    b.append(
      `${this.indent(3)}raise RuntimeError("${PYTHON_UNDEFINED_SENTINEL_CLASS} instances cannot be created directly. Import and use the ${undefinedSentinelName} sentinel instead.")\n`
    );
    b.append(`${this.indent(2)}else:\n`);
    b.append(`${this.indent(3)}${PYTHON_UNDEFINED_SENTINEL_CLASS}._instance = self\n\n`);

    b.append(`${this.indent(1)}@classmethod\n`);
    b.append(`${this.indent(1)}def __get_pydantic_core_schema__(cls, source, handler) -> core_schema.CoreSchema:\n`);
    b.append(`${this.indent(2)}return core_schema.with_info_plain_validator_function(cls.validate)\n\n`);

    b.append(`${this.indent(1)}@classmethod\n`);
    b.append(`${this.indent(1)}def validate(cls, value: typing.Any, info) -> ${PYTHON_UNDEFINED_SENTINEL_CLASS}:\n`);
    b.append(`${this.indent(2)}if not isinstance(value, cls):\n`);
    b.append(`${this.indent(3)}raise ValueError("Undefined field type is not valid")\n`);
    b.append(`${this.indent(2)}return value\n\n`);

    b.append(`${this.indent(0)}${undefinedSentinelName} = ${PYTHON_UNDEFINED_SENTINEL_CLASS}()\n`);
    b.append(
      `${this.indent(0)}"""A sentinel value that can be used to indicate that a value should be undefined. During serialization all values that are marked as undefined will be removed. The difference between \`${undefinedSentinelName}\` and \`None\` is that values that are set to \`None\` will serialize to explicit null."""`
    );

    return b.toString();
  }
  private generateStaticDeclarationsForTypesyncModel() {
    const { undefinedSentinelName } = this.config;
    const baseModel = this.config.customPydanticBase?.className ?? 'pydantic.BaseModel';

    const b = new StringBuilder();

    b.append(`${this.indent(0)}class TypesyncModel(${baseModel}):\n`);
    b.append(`${this.indent(1)}def model_dump(self, **kwargs) -> typing.Dict[str, typing.Any]:\n`);
    b.append(`${this.indent(2)}processed = {}\n`);
    b.append(`${this.indent(2)}for field_name, field_value in dict(self).items():\n`);
    b.append(`${this.indent(3)}if isinstance(field_value, pydantic.BaseModel):\n`);
    b.append(`${this.indent(4)}processed[field_name] = field_value.model_dump(**kwargs)\n`);
    b.append(`${this.indent(3)}elif isinstance(field_value, list):\n`);
    b.append(
      `${this.indent(4)}processed[field_name] = [item.model_dump(**kwargs) if isinstance(item, pydantic.BaseModel) else item for item in field_value]\n`
    );
    b.append(`${this.indent(3)}elif isinstance(field_value, dict):\n`);
    b.append(
      `${this.indent(4)}processed[field_name] = {key: value.model_dump(**kwargs) if isinstance(value, pydantic.BaseModel) else value for key, value in field_value.items()}\n`
    );
    b.append(`${this.indent(3)}elif field_value is ${undefinedSentinelName}:\n`);
    b.append(`${this.indent(4)}continue\n`);
    b.append(`${this.indent(3)}else:\n`);
    b.append(`${this.indent(4)}processed[field_name] = field_value\n`);
    b.append(`${this.indent(2)}return processed`);

    return b.toString();
  }

  private renderDeclaration(declaration: PythonDeclaration) {
    switch (declaration.type) {
      case 'alias':
        return this.renderAliasDeclaration(declaration);
      case 'enum-class':
        return this.renderEnumClassDeclaration(declaration);
      case 'pydantic-class': {
        return this.renderPydanticClassDeclaration(declaration);
      }
      default:
        assertNever(declaration);
    }
  }

  private renderAliasDeclaration(declaration: PythonAliasDeclaration) {
    const { modelName, modelType, modelDocs } = declaration;
    const expression = python.expressionForType(modelType);
    let output = `${modelName} = ${expression.content}`;
    if (modelDocs !== null) {
      output += `\n"""${modelDocs}"""`;
    }
    return output;
  }

  private renderEnumClassDeclaration(declaration: PythonEnumClassDeclaration) {
    const { modelName, modelType, modelDocs } = declaration;
    const b = new StringBuilder();
    b.append(`class ${modelName}(enum.Enum):\n`);
    if (modelDocs !== null) {
      b.append(`${this.indent(1)}"""${modelDocs}"""\n`);
    }
    modelType.attributes.forEach((attribute, attributeIdx) => {
      b.append(`${this.indent(1)}${attribute.key} = ${this.enumClassAttributeValueAsString(attribute)}`);
      if (attributeIdx !== modelType.attributes.length - 1) {
        b.append(`\n`);
      }
    });
    return b.toString();
  }

  private enumClassAttributeValueAsString(attribute: python.EnumClassAttribute) {
    switch (typeof attribute.value) {
      case 'string':
        return `"${attribute.value}"`;
      case 'number':
        return `${attribute.value}`;
      default:
        assertNever(attribute.value);
    }
  }

  private renderPydanticClassDeclaration(declaration: PythonPydanticClassDeclaration) {
    const { undefinedSentinelName } = this.config;
    const { modelName, modelType, modelDocs } = declaration;
    const b = new StringBuilder();
    b.append(`class ${modelName}(TypesyncModel):\n`);
    if (modelDocs !== null) {
      b.append(`${this.indent(1)}"""${modelDocs}"""\n`);
    }
    modelType.attributes.forEach(attribute => {
      if (attribute.optional) {
        const expression = python.expressionForType({
          type: 'simple-union',
          // NOTE: Optional means user can either not pass a key or pass null value
          variants: [attribute.type, python.UNDEFINED, python.NONE],
        });
        const content = attribute.deprecated
          ? `typing.Annotated[${expression.content}, pydantic.Field(deprecated=True)]`
          : expression.content;
        b.append(`${this.indent(1)}${attribute.name}: ${content} = ${undefinedSentinelName}`);
      } else {
        const expression = python.expressionForType(attribute.type);
        const content = attribute.deprecated
          ? `typing.Annotated[${expression.content}, pydantic.Field(deprecated=True)]`
          : expression.content;
        b.append(`${this.indent(1)}${attribute.name}: ${content}`);
      }
      if (attribute.docs !== null) {
        b.append(`\n${this.indent(1)}"""${attribute.docs}"""`);
      }
      b.append(`\n`);
    });
    b.append('\n');

    b.append(`${this.indent(1)}class Config:\n`);
    b.append(`${this.indent(2)}use_enum_values = True\n`);
    b.append(`${this.indent(2)}extra = '${modelType.additionalAttributes ? 'allow' : 'forbid'}'\n\n`);

    b.append(`${this.indent(1)}def __setattr__(self, name: str, value: typing.Any) -> None:\n`);
    modelType.attributes.forEach(attribute => {
      if (attribute.optional && !python.canBeNone(attribute.type)) {
        b.append(`${this.indent(2)}if name == "${attribute.name}" and value is None:\n`);
        b.append(`${this.indent(3)}raise ValueError("'${attribute.name}' field cannot be set to None")\n`);
      }
    });
    b.append(`${this.indent(2)}super().__setattr__(name, value)`);

    return b.toString();
  }

  private indent(count: number) {
    return multiply(space(this.config.indentation), count);
  }
}

export function createPythonRenderer(config: PythonRendererConfig): PythonRenderer {
  return new PythonRendererImpl(config);
}

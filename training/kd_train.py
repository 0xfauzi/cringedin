#!/usr/bin/env python3
"""
Knowledge Distillation trainer for the LinkedIn Cringe Filter.

Consumes JSONL datasets produced by tools/dataset-tool.js and fine-tunes a
compact encoder (e.g., DeBERTa-v3) using multi-label BCE loss against the
teacher probabilities.

Example:
    python training/kd_train.py \
        --train data/train.jsonl \
        --val data/val.jsonl \
        --model microsoft/deberta-v3-xsmall \
        --output ./student-checkpoint \
        --max_length 256 \
        --batch_size 32 \
        --epochs 3
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import classification_report, f1_score, precision_recall_fscore_support
from torch.utils.data import Dataset as TorchDataset
from transformers import (
    AutoConfig,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)

LABEL_KEYS: List[str] = [
    "humbleBragging",
    "excessiveEmojis",
    "engagementBait",
    "fakeStories",
    "companyCulture",
    "personalAnecdotes",
    "hiringStories",
    "basicDecencyPraising",
    "minorAchievements",
    "buzzwordOveruse",
    "linkedinCliches",
    "virtueSignaling",
    "professionalOversharing",
    "mundaneLifeLessons",
    "overall_cringe",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Knowledge distillation trainer for multi-label cringe classifier.")
    parser.add_argument("--train", required=True, help="Path to train JSONL file.")
    parser.add_argument("--val", required=True, help="Path to validation JSONL file.")
    parser.add_argument("--model", default="microsoft/deberta-v3-xsmall", help="Base encoder model.")
    parser.add_argument("--output", default="./student_ckpt", help="Directory to save the trained model.")
    parser.add_argument("--max_length", type=int, default=256, help="Maximum sequence length.")
    parser.add_argument("--batch_size", type=int, default=32, help="Per-device batch size.")
    parser.add_argument("--epochs", type=int, default=3, help="Number of epochs.")
    parser.add_argument("--learning_rate", type=float, default=3e-5, help="Learning rate.")
    parser.add_argument("--temperature", type=float, default=2.0, help="KD temperature.")
    parser.add_argument("--alpha_kl", type=float, default=0.7, help="Weight for KL component.")
    parser.add_argument("--alpha_ce", type=float, default=0.3, help="Weight for optional hard-label BCE (if available).")
    parser.add_argument("--positive_threshold", type=float, default=0.5, help="Threshold for metrics reporting.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    return parser.parse_args()


def load_jsonl(path: str) -> List[Dict]:
    with open(path, "r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def prepare_dataset(samples: List[Dict], tokenizer, max_length: int) -> TorchDataset:
    class KDDataset(TorchDataset):
        def __init__(self, data: List[Dict], tok):
            self.data = data
            self.tokenizer = tok

        def __len__(self):
            return len(self.data)

        def __getitem__(self, idx):
            sample = self.data[idx]
            text = sample.get("post", {}).get("text", "")
            labels = sample.get("teacher", {}).get("labels", {})
            teacher_probs = [float(labels.get(label, 0.0)) for label in LABEL_KEYS]

            inputs = self.tokenizer(
                text,
                truncation=True,
                padding="max_length",
                max_length=max_length,
                return_tensors="pt",
            )
            item = {k: v.squeeze(0) for k, v in inputs.items()}
            item["teacher_probs"] = torch.tensor(teacher_probs, dtype=torch.float32)
            # Optional hard labels if present (e.g., from human review)
            hard_labels = sample.get("human_labels")
            if hard_labels:
                item["labels"] = torch.tensor(
                    [1 if hard_labels.get(label) else 0 for label in LABEL_KEYS], dtype=torch.float32
                )
            else:
                item["labels"] = torch.tensor(teacher_probs, dtype=torch.float32)
            return item

    return KDDataset(samples, tokenizer)


def kd_loss(student_logits, teacher_probs, labels, temperature, alpha_kl, alpha_ce):
    t = temperature
    teacher_soft = teacher_probs ** (1.0 / t)
    teacher_soft = teacher_soft / teacher_soft.sum(dim=-1, keepdim=True).clamp(min=1e-9)

    student_log_soft = F.log_softmax(student_logits / t, dim=-1)
    kl = F.kl_div(student_log_soft, teacher_soft, reduction="batchmean") * (t * t)

    ce = F.binary_cross_entropy_with_logits(student_logits, labels, reduction="mean")
    return alpha_kl * kl + alpha_ce * ce


class KDTrainer(Trainer):
    def __init__(self, *args, temperature: float, alpha_kl: float, alpha_ce: float, **kwargs):
        super().__init__(*args, **kwargs)
        self.temperature = temperature
        self.alpha_kl = alpha_kl
        self.alpha_ce = alpha_ce

    def compute_loss(self, model, inputs, return_outputs=False):
        teacher_probs = inputs.pop("teacher_probs")
        labels = inputs.pop("labels")
        outputs = model(**inputs)
        loss = kd_loss(outputs.logits, teacher_probs, labels, self.temperature, self.alpha_kl, self.alpha_ce)
        return (loss, outputs) if return_outputs else loss


def seed_everything(seed: int):
    torch.manual_seed(seed)
    np.random.seed(seed)
    torch.cuda.manual_seed_all(seed)


def evaluate_model(trainer: KDTrainer, dataset: TorchDataset, threshold: float):
    predictions = trainer.predict(dataset)
    logits = predictions.predictions
    probs = torch.sigmoid(torch.tensor(logits)).numpy()
    hard_preds = (probs >= threshold).astype(int)
    hard_labels = np.array(
        [
            [1 if sample.get("human_labels", {}).get(label) else int(sample.get("teacher", {}).get("labels", {}).get(label, 0) >= threshold) for label in LABEL_KEYS]  # type: ignore
            for sample in dataset.data  # type: ignore
        ]
    )

    report = classification_report(
        hard_labels, hard_preds, target_names=LABEL_KEYS, zero_division=0, output_dict=True
    )
    macro_f1 = f1_score(hard_labels, hard_preds, average="macro", zero_division=0)
    prf = precision_recall_fscore_support(hard_labels, hard_preds, average="macro", zero_division=0)

    return {
        "macro_f1": float(macro_f1),
        "precision": float(prf[0]),
        "recall": float(prf[1]),
        "per_label": report,
    }


def main():
    args = parse_args()
    seed_everything(args.seed)

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    config = AutoConfig.from_pretrained(
        args.model,
        num_labels=len(LABEL_KEYS),
        problem_type="multi_label_classification",
    )
    student = AutoModelForSequenceClassification.from_pretrained(args.model, config=config)

    train_samples = load_jsonl(args.train)
    val_samples = load_jsonl(args.val)

    train_dataset = prepare_dataset(train_samples, tokenizer, args.max_length)
    val_dataset = prepare_dataset(val_samples, tokenizer, args.max_length)

    training_args = TrainingArguments(
        output_dir=args.output,
        overwrite_output_dir=True,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        num_train_epochs=args.epochs,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=50,
        report_to=["none"],
        seed=args.seed,
        fp16=torch.cuda.is_available(),
    )

    trainer = KDTrainer(
        model=student,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        tokenizer=tokenizer,
        temperature=args.temperature,
        alpha_kl=args.alpha_kl,
        alpha_ce=args.alpha_ce,
    )

    trainer.train()
    eval_metrics = trainer.evaluate()
    print("Validation loss:", eval_metrics.get("eval_loss"))

    metrics = evaluate_model(trainer, val_dataset, args.positive_threshold)
    print("Macro F1:", metrics["macro_f1"])
    print("Macro precision:", metrics["precision"])
    print("Macro recall:", metrics["recall"])

    metrics_path = Path(args.output) / "eval_metrics.json"
    with open(metrics_path, "w", encoding="utf-8") as fh:
        json.dump(metrics, fh, indent=2)

    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"✅ Model and tokenizer saved to {args.output}")
    print(f"📄 Metrics written to {metrics_path}")


if __name__ == "__main__":
    main()
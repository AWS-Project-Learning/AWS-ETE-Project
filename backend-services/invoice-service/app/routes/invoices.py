from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..models import Invoice, InvoiceStatus
from ..schemas import InvoiceCreate, InvoiceResponse, InvoicePaymentUpdate
from ..events import publish

router = APIRouter(prefix="/invoices", tags=["Invoices"])


@router.post("", response_model=InvoiceResponse, status_code=201)
def create_invoice(payload: InvoiceCreate, db: Session = Depends(get_db)):
    existing = db.query(Invoice).filter(Invoice.order_id == payload.order_id).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Invoice for order '{payload.order_id}' already exists")

    invoice = Invoice(**payload.model_dump())
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.get("", response_model=List[InvoiceResponse])
def list_invoices(
    status: Optional[InvoiceStatus] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Invoice)
    if status:
        query = query.filter(Invoice.status == status)
    return query.order_by(Invoice.issued_at.desc()).all()


@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Invoice '{invoice_id}' not found")
    return invoice


@router.get("/by-order/{order_id}", response_model=InvoiceResponse)
def get_invoice_by_order(order_id: str, db: Session = Depends(get_db)):
    invoice = db.query(Invoice).filter(Invoice.order_id == order_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail=f"No invoice found for order '{order_id}'")
    return invoice


@router.patch("/{invoice_id}/payment", response_model=InvoiceResponse)
def update_payment(invoice_id: str, payload: InvoicePaymentUpdate, db: Session = Depends(get_db)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Invoice '{invoice_id}' not found")

    invoice.status = payload.status

    if payload.status == InvoiceStatus.paid:
        invoice.paid_at = datetime.utcnow()
        publish("invoice.paid", {
            "invoice_id": invoice.id,
            "order_id":   invoice.order_id,
            "email":      invoice.email,
            "total":      invoice.total,
        })

    elif payload.status == InvoiceStatus.refunded:
        publish("invoice.refunded", {
            "invoice_id": invoice.id,
            "order_id":   invoice.order_id,
            "email":      invoice.email,
        })

    db.commit()
    db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail=f"Invoice '{invoice_id}' not found")
    db.delete(invoice)
    db.commit()

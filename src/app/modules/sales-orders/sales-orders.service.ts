import { Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import {
  PaymentMethodType,
  SalesOrderStatus,
  UserRole,
} from 'src/app/core/constants/domain.constants';
import { User } from 'src/app/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Product, ProductKey } from '../../schemas/product.schema';
import {
  SalesOrder,
  SalesOrderKey,
  SalesOrderListResponse,
} from '../../schemas/sales-order.schema';
import { handleError } from '../../shared/error.functions';
import {
  CreateSalesOrderDto,
  DailyPaymentMethodsResponseDto,
  DateRangeReportDto,
  ListSalesOrderDto,
  PaymentMethodSummaryDto,
  SalesOrderItemDto,
  SalesOrderPaymentMethodDto,
  SalesReportResponseDto,
  UpdateSalesOrderDto,
} from './dto/sales-orders.dto';

@Injectable()
export class SalesOrdersService extends TransactionSupport {
  constructor(
    @InjectModel('SalesOrder')
    private readonly model: Model<SalesOrder, SalesOrderKey>,
    @InjectModel('Product')
    private readonly productModel: Model<Product, ProductKey>,
  ) {
    super();
  }

  async create(
    body: CreateSalesOrderDto,
    user: User,
  ): Promise<GenericResponse<SalesOrder>> {
    try {
      const transactions = [];

      const salesOrder = await this.createOrderObject(body, user);

      const salesTransaction = this.model.transaction.create({
        ...salesOrder,
      });
      transactions.push(salesTransaction);

      await this.transaction([...transactions]);

      const salesOrderResult = await this.model.get({ id: salesOrder.id });
      // Return the created sales order
      return new GenericResponse(salesOrderResult);
    } catch (error) {
      throw handleError(error);
    }
  }

  async createOrderObject(
    body: CreateSalesOrderDto,
    user: User,
  ): Promise<SalesOrder> {
    const orderNumber = this.generateOrderNumber();

    // Fetch products from database to get accurate prices and stock info
    const productDetails = await this.fetchProductDetails(
      body.products,
      user.idBusiness,
    );

    const subTotalAmount = this.calculateSubTotalAmount(productDetails);
    const totalAmount = this.calculateTotalAmount(productDetails);
    const paidAmount = this.calculatePaidAmount(body.paymentMethods);
    const now = new Date();
    const totalCommissions = this.calculateTotalCommission(productDetails);
    const paidCommissions = this.calculatePaidCommission(
      productDetails,
      body.paymentMethods,
    );
    const totalIncome = this.calculateTotalIncome(productDetails);
    const paidIncome = this.calculatePaidIncome(
      productDetails,
      body.paymentMethods,
    );
    const totalDiscounts = this.calculateTotalDiscounts(productDetails);
    const paidDiscounts = this.calculatePaidDiscounts(
      productDetails,
      body.paymentMethods,
    );
    const totalCosts = this.calculateTotalCost(productDetails);
    const paidCosts = this.calculatePaidCosts(
      productDetails,
      body.paymentMethods,
    );
    const salesOrder: SalesOrder = {
      id: uuidv4(),
      subTotalAmount,
      totalDiscounts,
      totalCommissions,
      totalIncome,
      paidDiscounts,
      paidCommissions,
      paidIncome,
      totalCosts,
      paidCosts,
      orderNumber,
      idCustomer: body.idCustomer,
      products: productDetails,
      paymentMethods: body.paymentMethods,
      paidAmount,
      totalAmount,
      status:
        paidAmount === 0
          ? SalesOrderStatus.pending
          : paidAmount === totalAmount
          ? SalesOrderStatus.paid
          : SalesOrderStatus.partiallyPaid,
      idBusiness: user.idBusiness,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    return salesOrder;
  }
  async update(
    id: string,
    body: UpdateSalesOrderDto,
    user: User,
  ): Promise<GenericResponse<SalesOrder>> {
    try {
      // OPTIMIZACIÓN: Usar get() en lugar de scan() para búsqueda por ID (clave primaria)
      const salesOrder = await this.model.get({ id });

      if (!salesOrder) {
        throw new Error('MS007');
      }

      // Validar que pertenece al negocio del usuario
      if (salesOrder.idBusiness !== user.idBusiness) {
        throw new Error('MS007');
      }

      const updatedSalesOrder = await this.model.update(
        { id: salesOrder.id },
        { ...body, modifiedBy: user.id },
      );
      return new GenericResponse(updatedSalesOrder);
    } catch (error) {
      throw handleError(error);
    }
  }

  async findAll(
    user: User,
    filters?: ListSalesOrderDto,
  ): Promise<GenericResponse<SalesOrderListResponse>> {
    try {
      if (!user.idBusiness) {
        throw new Error('MS014');
      }
      if (
        !moment(filters?.startDate).isValid() ||
        !moment(filters?.endDate).isValid()
      ) {
        throw new Error('MS014');
      }
      const result = await this.getSalesInDateRange(
        filters?.startDate,
        filters?.endDate,
        user,
        filters?.limit,
        filters?.lastKey,
      );
      let response: SalesOrderListResponse | null = null;
      if (result.length > 0) {
        response = {
          salesOrders: result,
          totalPages: Math.ceil(result.length / 10),
          totalItems: result.length,
          lastKey: result[result.length - 1]?.id,
        };
      } else {
        response = {
          salesOrders: [],
          totalPages: 0,
          totalItems: 0,
          lastKey: null,
        };
      }

      return new GenericResponse(response);
    } catch (error) {
      throw handleError(error);
    }
  }

  async findOne(id: string): Promise<GenericResponse<SalesOrder>> {
    try {
      // Validate id
      if (!id) {
        throw new Error('MS014');
      }

      const salesOrder = await this.model.get({ id });
      if (!salesOrder) {
        throw new Error('MS007');
      }
      return new GenericResponse(salesOrder as SalesOrder);
    } catch (error) {
      throw handleError(error);
    }
  }

  async findByOrderNumber(
    orderNumber: string,
  ): Promise<GenericResponse<SalesOrder>> {
    try {
      // Validate orderNumber
      if (!orderNumber) {
        throw new Error('MS014');
      }

      // OPTIMIZACIÓN: Usar query con GSI orderNumber-index en lugar de scan
      const salesOrders = await this.model
        .query('orderNumber')
        .using('orderNumber-index')
        .eq(orderNumber)
        .exec();

      if (!salesOrders || salesOrders.length === 0) {
        throw new Error('MS007');
      }

      return new GenericResponse(salesOrders[0] as SalesOrder);
    } catch (error) {
      throw handleError(error);
    }
  }

  async remove(id: string): Promise<GenericResponse<SalesOrder>> {
    try {
      // Validate id
      if (!id) {
        throw new Error('MS014');
      }

      await this.model.update({ id }, { status: SalesOrderStatus.canceled });
      const updatedSalesOrder = await this.model.get({ id });
      return new GenericResponse(updatedSalesOrder);
    } catch (error) {
      throw handleError(error);
    }
  }

  private async fetchProductDetails(
    products: SalesOrderItemDto[],
    idBusiness: string,
  ): Promise<(Partial<Product> & SalesOrderItemDto)[]> {
    const productIds = products.map((product) => product.id);

    // OPTIMIZACIÓN: Usar múltiples get() en paralelo en lugar de scan con in()
    const productPromises = productIds.map((id) =>
      this.productModel.get({ id }),
    );

    const productDetailsArray = await Promise.all(productPromises);

    // Filtrar productos que pertenecen al negocio
    const validProducts = productDetailsArray.filter(
      (product) => product && product.idBusiness === idBusiness,
    );

    if (!validProducts || validProducts.length !== productIds.length) {
      throw new Error('MS007');
    }

    return validProducts.map((product) => ({
      id: product.id,
      quantity: products.find((p) => p.id === product.id)?.quantity ?? 0,
      isService: product.isService,
      price: product.price,
      offerPrice: product.offerPrice,
      commissions: product.commissions,
    }));
  }

  /**
   * Calcula el valor total monetario de los productos
   * @param productDetails
   * @returns El valor total de los productos en formato monetario
   */
  private calculateSubTotalAmount(productDetails: SalesOrderItemDto[]): number {
    return productDetails.reduce(
      (total, product) =>
        total + (product.price || 0) * (product.quantity || 0),
      0,
    );
  }
  /**
   * Calcula el valor total monetario de los productos
   * @param productDetails
   * @returns El valor total de los productos en formato monetario
   */
  private calculateTotalAmount(productDetails: SalesOrderItemDto[]): number {
    return productDetails.reduce(
      (total, product) =>
        total +
        (product.offerPrice || product.price || 0) * (product.quantity || 0),
      0,
    );
  }

  /**
   * Calcula el valor total monetario de los pagos realizados
   * @param paymentMethods
   * @returns El valor total de los pagos realizados en formato monetario
   */
  private calculatePaidAmount(
    paymentMethods: SalesOrderPaymentMethodDto[],
  ): number {
    return paymentMethods.reduce((acc, item) => {
      return acc + item.value;
    }, 0);
  }

  /**
   * Calcula el valor total monetario de las comisiones de los productos
   * Las comisiones son un porcentaje del precio de venta
   * @param productDetails
   * @returns El valor total de comisiones de los productos en formato monetario
   */
  private calculateTotalCommission(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
  ): number {
    // commissions es un porcentaje, devuelve el valor monetario
    return productDetails.reduce((total, product) => {
      const commissionsPercent = product.commissions || 0;
      const productTotal = this.calculateTotalAmount([product]);
      const commissionValue = (commissionsPercent / 100) * productTotal;
      return total + commissionValue;
    }, 0);
  }

  /**
   * Calcula el valor total monetario de las comisiones pagadas
   * @param productDetails
   * @param paymentMethods
   * @returns El valor total de las comisiones pagadas en formato monetario
   */
  private calculatePaidCommission(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
    paymentMethods: SalesOrderPaymentMethodDto[],
  ): number {
    const totalAmount = this.calculateTotalAmount(productDetails);
    const paidAmount = this.calculatePaidAmount(paymentMethods);
    const totalCommission = this.calculateTotalCommission(productDetails);
    const percentageCommission = totalCommission / totalAmount;
    const paidCommission = percentageCommission * paidAmount;
    return paidCommission;
  }

  /**
   * Calcula el valor total monetario de las
   * @param productDetails
   * @returns El valor total de las ventas en formato monetario
   */
  private calculateTotalIncome(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
  ): number {
    return (
      this.calculateTotalAmount(productDetails) -
      this.calculateTotalCommission(productDetails) -
      this.calculateTotalCost(productDetails)
    );
  }

  /**
   * Calcula el valor total monetario de las ventas pagadas
   * @param productDetails
   * @param paymentMethods
   * @returns El valor total de las ventas pagadas en formato monetario
   */
  private calculatePaidIncome(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
    paymentMethods: SalesOrderPaymentMethodDto[],
  ): number {
    const totalIncome = this.calculateTotalIncome(productDetails);
    const paidAmount = this.calculatePaidAmount(paymentMethods);
    const percentageIncome = paidAmount / totalIncome;
    const paidIncome = percentageIncome * paidAmount;
    return paidIncome;
  }

  /**
   * Calcula el valor total monetario de los descuentos
   * @param productDetails
   * @returns El valor total de los descuentos en formato monetario
   */
  private calculateTotalDiscounts(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
  ): number {
    const totalOfferPrice = productDetails.reduce(
      (total, product) =>
        total + (product.offerPrice || 0) * (product.quantity || 0),
      0,
    );
    return totalOfferPrice;
  }

  private calculatePaidDiscounts(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
    paymentMethods: SalesOrderPaymentMethodDto[],
  ): number {
    const totalAmount = this.calculateTotalAmount(productDetails);
    const paidAmount = this.calculatePaidAmount(paymentMethods);
    const percentageDiscounts = totalAmount / paidAmount;
    const paidDiscounts = percentageDiscounts * totalAmount;
    return paidDiscounts;
  }

  /**
   * Calcula el valor total monetario de los costos de los productos
   * @param productDetails
   * @returns El valor total de los costos de los productos en formato monetario
   */
  private calculateTotalCost(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
  ): number {
    return productDetails.reduce((total, product) => {
      return total + (product.costPrice || 0) * (product.quantity || 0);
    }, 0);
  }

  private calculatePaidCosts(
    productDetails: (Partial<Product> & SalesOrderItemDto)[],
    paymentMethods: SalesOrderPaymentMethodDto[],
  ): number {
    const totalCost = this.calculateTotalCost(productDetails);
    const paidAmount = this.calculatePaidAmount(paymentMethods);
    const percentageCosts = paidAmount / totalCost;
    const paidCosts = percentageCosts * paidAmount;
    return paidCosts;
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `SO${timestamp.toString().slice(-6)}${shortId}${random
      .toString()
      .padStart(4, '0')}`;
  }

  async getDailySalesCards(
    dateRange: DateRangeReportDto,
    user: User,
  ): Promise<GenericResponse<SalesReportResponseDto>> {
    try {
      // Validate idBusiness
      if (!user.idBusiness) {
        throw new Error('MS014');
      }

      const startDate = moment(dateRange.startDate).startOf('day');
      const endDate = moment(dateRange.endDate).endOf('day');
      // Calcular el período anterior con la misma duración
      const periodDuration = moment.duration(endDate.diff(startDate));
      const previousEndDate = moment(startDate);
      const previousStartDate =
        moment(previousEndDate).subtract(periodDuration);

      // Obtener ventas del período actual
      const currentPeriodSales = await this.getSalesInDateRange(
        startDate.toDate(),
        endDate.toDate(),
        user,
      );
      // Obtener ventas del período anterior
      const previousPeriodSales = await this.getSalesInDateRange(
        previousStartDate.toDate(),
        previousEndDate.toDate(),
        user,
      );
      // Calcular totales
      const currentValue = this.calculateTotalFromSales(currentPeriodSales);
      const lastValue = this.calculateTotalFromSales(previousPeriodSales);

      // Determinar la frecuencia basada en la duración del período
      const frequency = this.determineFrequencyWithMoment(startDate, endDate);

      const report: SalesReportResponseDto = {
        title: frequency,
        description: `Último ${frequency.toLowerCase()}`,
        currentValue,
        lastValue,
        isCurrency: true,
        frequency: frequency.toLowerCase(),
      };

      return new GenericResponse(report);
    } catch (error) {
      throw handleError(error);
    }
  }

  private async getSalesInDateRange(
    startDate: Date,
    endDate: Date,
    user: User,
    limit?: number,
    lastKey?: string,
  ): Promise<SalesOrder[]> {
    try {
      // Validate idBusiness is not undefined or null
      if (!user.idBusiness) {
        throw new Error('MS014');
      }
      // if(moment is valid date)
      if (!moment(startDate).isValid() || !moment(endDate).isValid()) {
        throw new Error('MS014');
      }
      startDate = moment(startDate).startOf('day').toDate();
      endDate = moment(endDate).endOf('day').toDate();

      const query = this.model
        .query('idBusiness')
        .using('businessInfo-index')
        .eq(user.idBusiness)
        .between(startDate.toISOString(), endDate.toISOString());

      if (lastKey) {
        query.startAt({ id: lastKey });
      }
      if (limit) {
        query.limit(limit);
      }
      const result = await query.exec();

      // OPTIMIZACIÓN: Usar query con businessInfo-index y luego filtrar por fecha
      // Nota: DynamoDB no permite filtrar por createdAt directamente en un GSI,
      // pero podemos usar query y filtrar en memoria (aún más eficiente que scan completo)

      return result;
    } catch (error) {
      throw handleError(error);
    }
  }

  private calculateTotalFromSales(salesOrders: SalesOrder[]): number {
    return salesOrders.reduce((total, order) => {
      return total + (order.totalAmount || 0);
    }, 0);
  }

  private determineFrequencyWithMoment(
    startDate: moment.Moment,
    endDate: moment.Moment,
  ): string {
    const durationDays = endDate.diff(startDate, 'days') + 1; // +1 para incluir ambos días

    if (durationDays === 1) {
      return 'Día';
    } else if (durationDays <= 7) {
      return 'Semana';
    } else if (durationDays <= 31) {
      return 'Mes';
    } else if (durationDays <= 365) {
      return 'Año';
    } else {
      return 'Período';
    }
  }

  async getDailyPaymentMethodsSummary(
    user: User,
  ): Promise<GenericResponse<DailyPaymentMethodsResponseDto>> {
    try {
      // Validate idBusiness
      if (!user.idBusiness) {
        throw new Error('MS014');
      }

      // Obtener todas las órdenes del día actual para el negocio
      const today = moment().startOf('day');
      const endOfDay = moment().endOf('day');

      const todayOrders = await this.getSalesInDateRange(
        today.toDate(),
        endOfDay.toDate(),
        user,
      );

      // Calcular el total de ventas del día
      const totalDailySales = this.calculateTotalFromSales(todayOrders);

      // Procesar métodos de pago
      const paymentMethodsMap = new Map<
        string,
        { total: number; count: number }
      >();

      // Iterar por cada orden y sus métodos de pago
      todayOrders.forEach((order) => {
        order.paymentMethods.forEach((payment) => {
          const methodType = payment.type;
          const currentData = paymentMethodsMap.get(methodType) || {
            total: 0,
            count: 0,
          };

          paymentMethodsMap.set(methodType, {
            total: currentData.total + payment.value,
            count: currentData.count + 1,
          });
        });
      });

      // Convertir el mapa a array de DTOs, incluyendo todos los métodos de pago
      const paymentMethods: PaymentMethodSummaryDto[] = [];

      // Iterar por todos los métodos de pago disponibles
      Object.values(PaymentMethodType).forEach((methodType) => {
        const data = paymentMethodsMap.get(methodType) || {
          total: 0,
          count: 0,
        };
        const percentage =
          totalDailySales > 0 ? (data.total / totalDailySales) * 100 : 0;

        paymentMethods.push({
          paymentMethod: methodType,
          totalAmount: data.total,
          transactionCount: data.count,
          percentage: Math.round(percentage * 100) / 100, // Redondear a 2 decimales
        });
      });

      // Ordenar por mayor monto
      paymentMethods.sort((a, b) => b.totalAmount - a.totalAmount);

      const response: DailyPaymentMethodsResponseDto = {
        date: today.format('YYYY-MM-DD'),
        totalDailySales,
        paymentMethods,
        totalOrders: todayOrders.length,
      };

      return new GenericResponse(response);
    } catch (error) {
      throw handleError(error);
    }
  }

  private isAdmin(user: User): boolean {
    return user.role === UserRole.admin || user.role === UserRole.superadmin;
  }
}
